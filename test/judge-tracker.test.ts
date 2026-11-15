import { describe, expect, it } from 'vitest';
import { JudgeTracker, KEEP_DISCONNECTED_MS, mergeJudges, taskInfo } from '../lib/judge-tracker';

const start = Date.UTC(2026, 10, 16, 2, 0, 0);
const task = (rid: string) => ({ rid, domainId: 'system', uid: 1, pid: 100, lang: 'cc', contest: 'c1' });

describe('judge tracking', () => {
    it('reads Hydro judge tasks', () => {
        expect(taskInfo({ rid: { toString: () => 'r1' }, domainId: 'system', uid: 5, pid: 3, lang: 'py', contest: { toString: () => 'c9' }, code: 'x' }))
            .toEqual({ rid: 'r1', domainId: 'system', uid: 5, pid: 3, lang: 'py', contest: 'c9' });
        expect(taskInfo({ _id: 'r2', domainId: 'system' })).toMatchObject({ rid: 'r2', contest: null });
        expect(taskInfo({ rid: 'r3' })).toBeNull();
    });

    it('follows a daemon: configuration, machine id, progress and results', () => {
        let t = start;
        const tracker = new JudgeTracker('hydro', () => t);
        tracker.connect('d', { uname: 'judge', ip: '10.0.0.2' });
        tracker.message('d', { key: 'config', concurrency: 4, lang: ['cc', 'py'] });
        tracker.message('d', { key: 'status', info: { mid: 'abc' } });
        tracker.taskStart('d', task('r1'));
        t += 2000;
        tracker.message('d', { key: 'next', rid: 'r1', status: 21 });
        tracker.message('d', { key: 'next', rid: 'r1', status: 20, case: {}, addProgress: 30 });
        expect(tracker.snapshot()[0].active[0]).toMatchObject({ rid: 'r1', status: 20, casesDone: 1, progress: 30 });
        t += 3000;
        tracker.message('d', { key: 'end', rid: 'r1', status: 1, time: 15, memory: 1024 });
        tracker.message('d', { key: 'end', rid: 'unknown', status: 1 });
        const [judge] = tracker.snapshot();
        expect(judge).toMatchObject({ mid: 'abc', concurrency: 4, langs: ['cc', 'py'], active: [], totals: { judged: 1, systemErrors: 0 } });
        expect(judge.recent[0]).toMatchObject({ rid: 'r1', status: 1, durationMs: 5000, timeMs: 15, memoryKb: 1024 });
        expect(judge.minutes).toEqual([{ minute: Math.floor(t / 60_000), judged: 1, accepted: 1, systemErrors: 0, durationSum: 5000, durationCount: 1, durationMax: 5000 }]);
        // Hydro's record/judge for the same record is the daemon's, not the built-in judge's.
        tracker.builtinFinish(task('r1'), { status: 1 });
        expect(tracker.snapshot().map((item) => item.kind)).toEqual(['remote']);
    });

    it('lets go of tasks a daemon gave up and of daemons gone for a while', () => {
        let t = start;
        const tracker = new JudgeTracker('hydro', () => t);
        tracker.connect('d', { uname: 'judge', ip: null });
        tracker.taskStart('d', task('r1'));
        tracker.taskDone('d', 'r1');
        expect(tracker.snapshot()[0].active).toEqual([]);
        tracker.taskStart('d', task('r2'));
        tracker.disconnect('d');
        expect(tracker.snapshot()[0]).toMatchObject({ disconnectedAt: start, active: [] });
        t += KEEP_DISCONNECTED_MS + 1;
        expect(tracker.snapshot()).toEqual([]);
    });

    it('follows the built-in judge through record changes and results', () => {
        let t = start;
        const tracker = new JudgeTracker('hydro', () => t);
        tracker.builtinChange(task('b1'), 0, 0, null); // queued: not taken yet
        expect(tracker.snapshot()).toEqual([]);
        tracker.builtinChange(task('b1'), 21, 0, null);
        t += 4000;
        tracker.builtinChange(task('b1'), 20, 2, 50);
        expect(tracker.snapshot()[0].active[0]).toMatchObject({ rid: 'b1', status: 20, casesDone: 2, progress: 50, startedAt: start });
        tracker.builtinFinish(task('b1'), { status: 2, time: 30, memory: 900 });
        const [judge] = tracker.snapshot();
        expect(judge).toMatchObject({ id: 'builtin:hydro', kind: 'builtin', host: 'hydro', active: [], totals: { judged: 1, systemErrors: 0 } });
        expect(judge.recent[0]).toMatchObject({ status: 2, durationMs: 4000 });
        // A result broadcast from elsewhere clears it; a task held by a daemon here is never built-in.
        tracker.builtinChange(task('b2'), 20, 0, null);
        tracker.builtinChange(task('b2'), 1, 5, null);
        tracker.connect('d', { uname: 'judge', ip: null });
        tracker.taskStart('d', task('r9'));
        tracker.builtinChange(task('r9'), 20, 1, null);
        expect(tracker.snapshot().find((item) => item.kind === 'builtin')!.active).toEqual([]);
        // Abandoned built-in tasks expire.
        tracker.builtinChange(task('b3'), 20, 0, null);
        t += 11 * 60_000;
        expect(tracker.snapshot().find((item) => item.kind === 'builtin')!.active).toEqual([]);
    });

    it('merges processes: daemons per connection, the built-in judge per server', () => {
        const t = start;
        const a = new JudgeTracker('hydro', () => t);
        const b = new JudgeTracker('hydro', () => t);
        const other = new JudgeTracker('hydro-2', () => t);
        a.connect('d', { uname: 'judge', ip: null });
        a.taskStart('d', task('r1'));
        a.builtinFinish(task('x1'), { status: 1 });
        b.builtinChange(task('r1'), 20, 0, null); // a daemon's record, broadcast to process b
        b.builtinChange(task('x2'), 20, 0, null);
        b.builtinFinish(task('x3'), { status: 8 });
        other.builtin();
        const merged = mergeJudges([{ host: 'hydro', judges: a.snapshot() }, { host: 'hydro', judges: b.snapshot() }, { host: 'hydro-2', judges: other.snapshot() }]);
        expect(merged.map((judge) => [judge.id, judge.kind])).toEqual([['d', 'remote'], ['builtin:hydro', 'builtin'], ['builtin:hydro-2', 'builtin']]);
        const builtin = merged[1];
        expect(builtin.active.map((item) => item.rid)).toEqual(['x2']);
        expect(builtin.totals).toEqual({ judged: 2, systemErrors: 1 });
        expect(builtin.minutes).toHaveLength(1);
        expect(builtin.minutes[0]).toMatchObject({ judged: 2, accepted: 1, systemErrors: 1 });
    });
});
