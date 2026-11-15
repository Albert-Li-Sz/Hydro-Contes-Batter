import { describe, expect, it } from 'vitest';
import { JudgeTracker } from '../lib/judge-tracker';
import { type MachineMetrics, type MonitorMachine, monitorSnapshot, type MonitorRecord } from '../lib/monitor';

const begin = Date.UTC(2026, 10, 16, 1, 0, 0);
const now = begin + 90 * 60_000;
const at = (minute: number) => begin + minute * 60_000;
const record = (id: string, minute: number, status: number, extra: Partial<MonitorRecord> = {}): MonitorRecord => ({
    id, submittedAt: at(minute), status, uid: 1, pid: 100, lang: 'cc', judgeAt: at(minute) + 20_000, ...extra,
});
const metrics = (extra: Partial<MachineMetrics> = {}): MachineMetrics => ({
    cpu: 30, memoryRate: 40, memoryTotal: 8 * 1024 ** 3, temperature: 55, cores: 8, model: 'Test CPU', os: 'Linux', compilers: 3, reportedAt: now - 5 * 60_000, ...extra,
});
const task = (rid: string, extra: Partial<{ domainId: string; contest: string | null; uid: number; pid: number }> = {}) => ({
    rid, domainId: 'system', uid: 1, pid: 100, lang: 'cc', contest: 'c1', ...extra,
});

/** A daemon connected 20 minutes ago that judged a few runs. */
function daemon(clock: { t: number }) {
    const tracker = new JudgeTracker('hydro', () => clock.t);
    clock.t = now - 20 * 60_000;
    tracker.connect('d1', { uname: 'judge', ip: '10.0.0.2' });
    tracker.message('d1', { key: 'config', concurrency: 2 });
    tracker.message('d1', { key: 'status', info: { mid: 'mid-1' } });
    return tracker;
}

function snapshot(records: MonitorRecord[], machines: MonitorMachine[] = []) {
    return monitorSnapshot({
        now, contest: { domainId: 'system', id: 'c1' }, records, machines, queueLength: 4,
        problems: [{ pid: 100, label: 'A' }, { pid: 101, label: 'B' }],
        teamOf: (uid) => (uid === 2 || uid === 3 ? { id: '-1001', name: '星火队' } : uid === 1 ? { id: '1', name: '林澈' } : null),
    });
}

describe('judge monitoring', () => {
    it('reports waiting submissions oldest first, with a warning past three minutes', () => {
        const clock = { t: 0 };
        const tracker = daemon(clock);
        clock.t = now - 40_000;
        tracker.taskStart('d1', task('t1'));
        tracker.message('d1', { key: 'end', rid: 't1', status: 1 }); // judging moves
        clock.t = now;
        const data = snapshot([
            record('r1', 89, 1),
            record('r2', 86, 0, { judgeAt: null }),
            record('r3', 89, 20, { judgeAt: null, uid: 2, pid: 101 }),
        ], [{ key: 'd1', name: 'judge-a', kind: 'remote', tracked: tracker.snapshot()[0], metrics: metrics() }]);
        expect(data.summary).toMatchObject({ total: 3, accepted: 1, pending: 2, queueLength: 4, oldestPendingSeconds: 240 });
        expect(data.pending.map((item) => [item.id, item.team, item.problem, item.status])).toEqual([['r2', '林澈', 'A', '等待评测'], ['r3', '星火队', 'B', '评测中']]);
        expect(data.alerts).toEqual([{ level: 'warning', text: '有提交已等待评测 4 分 0 秒' }]);
    });

    it('measures each judge machine: load, throughput, judging time, results and its machine numbers', () => {
        const clock = { t: 0 };
        const tracker = daemon(clock);
        // Three runs in the last 15 minutes, one an hour ago is out of every window.
        for (const [rid, minutesAgo, seconds, status] of [['a', 12, 4, 1], ['b', 3, 10, 2], ['c', 0.5, 6, 8]] as const) {
            clock.t = now - minutesAgo * 60_000 - seconds * 1000;
            tracker.taskStart('d1', task(rid));
            clock.t += seconds * 1000;
            tracker.message('d1', { key: 'end', rid, status, time: 120, memory: 2048 });
        }
        clock.t = now - 30_000;
        tracker.taskStart('d1', task('live', { uid: 2, pid: 101 }));
        tracker.message('d1', { key: 'next', rid: 'live', status: 20, case: { status: 1 }, progress: 25 });
        tracker.message('d1', { key: 'next', rid: 'live', status: 20, cases: [{}, {}] });
        clock.t = now;
        const data = snapshot([], [{ key: 'd1', name: 'judge-a', kind: 'remote', tracked: tracker.snapshot()[0], metrics: metrics() }]);
        const [machine] = data.machines;
        expect(machine).toMatchObject({
            name: 'judge-a', state: 'busy', online: true, account: 'judge', ip: '10.0.0.2', connectedSeconds: 1200,
            concurrency: 2, activeCount: 1, utilization: 50,
            judged1: 1, judged5: 2, judged15: 3, accepted15: 1, systemErrors15: 1, totalJudged: 3,
            averageSeconds: 6.7, maxSeconds: 10, lastFinishedSeconds: 30,
        });
        expect(machine.perMinute).toHaveLength(30);
        expect(machine.perMinute.reduce((a, b) => a + b, 0)).toBe(3);
        expect(machine.metrics).toMatchObject({ cpu: 30, live: false, reportedSecondsAgo: 300 });
        expect(data.summary).toMatchObject({ judgesOnline: 1, judgesTotal: 1, activeTasks: 1, capacity: 2, judgedPerMinute: 0.4, judged15: 3, averageJudgeSeconds: 6.7 });
        expect(data.live).toEqual([{ judge: 'judge-a', inContest: true, rid: 'live', team: '星火队', problem: 'B', lang: 'cc', status: '评测中', casesDone: 3, progress: 25, elapsedSeconds: 30 }]);
        expect(data.finished.map((item) => [item.rid, item.status, item.tone, item.durationSeconds, item.timeMs, item.memoryKb])).toEqual([
            ['c', '系统错误', 'error', 6, 120, 2048], ['b', '答案错误', 'bad', 10, 120, 2048], ['a', '通过', 'ok', 4, 120, 2048],
        ]);
    });

    it('shows other contests and domains only by language', () => {
        const clock = { t: 0 };
        const tracker = daemon(clock);
        clock.t = now - 5000;
        tracker.taskStart('d1', task('x1', { domainId: 'other', contest: 'c1' }));
        tracker.taskStart('d1', task('x2', { contest: null }));
        clock.t = now;
        const data = snapshot([], [{ key: 'd1', name: 'judge-a', kind: 'remote', tracked: tracker.snapshot()[0], metrics: null }]);
        expect(data.live.map((item) => [item.inContest, item.rid, item.team, item.problem, item.lang])).toEqual([[false, null, null, null, 'cc'], [false, null, null, null, 'cc']]);
    });

    it('alerts on disconnected and unconnected judges, system errors and machine pressure', () => {
        const clock = { t: 0 };
        const tracker = daemon(clock);
        for (const rid of ['e1', 'e2', 'e3']) {
            clock.t = now - 60_000;
            tracker.taskStart('d1', task(rid));
            tracker.message('d1', { key: 'end', rid, status: 8 });
        }
        clock.t = now;
        const gone = new JudgeTracker('hydro', () => clock.t);
        clock.t = now - 10 * 60_000;
        gone.connect('d2', { uname: 'judge', ip: '10.0.0.3' });
        clock.t = now - 4 * 60_000;
        gone.disconnect('d2');
        clock.t = now;
        const data = snapshot([record('s1', 87, 8), record('s2', 88, 8), record('s3', 89, 10)], [
            { key: 'd1', name: 'judge-a', kind: 'remote', tracked: tracker.snapshot()[0], metrics: metrics({ cpu: 97, memoryRate: 91 }) },
            { key: 'd2', name: 'judge-b', kind: 'remote', tracked: gone.snapshot()[0], metrics: null },
            { key: 'report:x', name: 'judge-c', kind: 'remote', tracked: null, metrics: metrics({ reportedAt: now - 10 * 60_000 }) },
            { key: 'report:y', name: 'retired', kind: 'remote', tracked: null, metrics: metrics({ reportedAt: now - 3 * 3600_000 }) },
        ]);
        expect(data.machines.map((machine) => [machine.name, machine.state])).toEqual([
            ['judge-a', 'idle'], ['judge-b', 'offline'], ['judge-c', 'offline'], ['retired', 'offline'],
        ]);
        expect(data.alerts.map((alert) => alert.text)).toEqual([
            '评测机 judge-a 最近 5 分钟出现 3 次系统错误',
            '评测机 judge-a CPU 使用率 97%（上报值）',
            '评测机 judge-a 内存占用 91%（上报值）',
            '评测机 judge-b 在 4 分钟前断开连接',
            '评测机 judge-c 没有连接到 Hydro（10 分钟前还有上报）',
            '本场比赛最近 5 分钟出现 3 次系统错误',
        ]);
        expect(data.systemErrors.map((item) => item.id)).toEqual(['s3', 's2', 's1']);
        expect(snapshot([]).alerts).toEqual([{ level: 'error', text: '没有在线的评测机' }]);
    });

    it('takes the built-in judge as online with live machine numbers', () => {
        const clock = { t: now };
        const tracker = new JudgeTracker('hydro', () => clock.t);
        const data = snapshot([], [{ key: 'b', name: '内置评测（hydro）', kind: 'builtin', tracked: tracker.builtin() && tracker.snapshot()[0], metrics: metrics({ reportedAt: null, cpu: 99 }) }]);
        expect(data.machines[0]).toMatchObject({ kind: 'builtin', online: true, state: 'idle', concurrency: null, metrics: { live: true } });
        expect(data.alerts).toEqual([{ level: 'warning', text: '评测机 内置评测（hydro） CPU 使用率 99%' }]);
        expect(data.summary).toMatchObject({ capacity: 0, capacityKnown: false });
    });

    it('says judging stopped when submissions wait and nothing was judged lately', () => {
        const machines: MonitorMachine[] = [{ key: 'b', name: '内置', kind: 'builtin', tracked: new JudgeTracker('h', () => now).builtin(), metrics: null }];
        const stalled = snapshot([record('done', 80, 1), record('w1', 85, 0, { judgeAt: null }), record('w2', 88, 0, { judgeAt: null })], machines);
        expect(stalled.alerts).toEqual([{ level: 'error', text: '评测似乎停止：2 条提交等待中，最近 3 分钟没有完成任何评测' }]);
        // Still judging (one finished a minute ago): only the long wait is reported.
        const busy = snapshot([record('done', 88, 1, { judgeAt: at(89) }), record('w1', 85, 0, { judgeAt: null })], machines);
        expect(busy.alerts).toEqual([{ level: 'warning', text: '有提交已等待评测 5 分 0 秒' }]);
    });
});
