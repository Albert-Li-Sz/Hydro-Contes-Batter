import { describe, expect, it } from 'vitest';
import { monitorSnapshot, type MonitorRecord } from '../lib/monitor';

const begin = Date.UTC(2026, 10, 16, 1, 0, 0);
const now = begin + 90 * 60_000;
const at = (minute: number) => begin + minute * 60_000;
const record = (id: string, minute: number, status: number, extra: Partial<MonitorRecord> = {}): MonitorRecord => ({
    id, submittedAt: at(minute), status, uid: 1, pid: 100, lang: 'cc', judgeAt: at(minute) + 20_000, ...extra,
});

function snapshot(records: MonitorRecord[], judges = [{ mid: 'judge-1', updateAt: now - 30_000 }]) {
    return monitorSnapshot({
        now, beginAt: begin, endAt: begin + 300 * 60_000, records, judges, queueLength: 4,
        problems: [{ pid: 100, label: 'A' }, { pid: 101, label: 'B' }],
        teamOf: (uid) => (uid === 2 || uid === 3 ? { id: '-1001', name: '星火队' } : uid === 1 ? { id: '1', name: '林澈' } : null),
    });
}

describe('judge monitoring', () => {
    it('reports waiting submissions oldest first, with a warning past three minutes', () => {
        const data = snapshot([
            record('r1', 80, 1),
            record('r2', 86, 0, { judgeAt: null }),
            record('r3', 89, 20, { judgeAt: null, uid: 2, pid: 101 }),
        ]);
        expect(data.summary).toMatchObject({ total: 3, accepted: 1, pending: 2, queueLength: 4, oldestPendingSeconds: 240 });
        expect(data.pending.map((item) => [item.id, item.team, item.problem, item.status])).toEqual([['r2', '林澈', 'A', '等待评测'], ['r3', '星火队', 'B', '评测中']]);
        expect(data.alerts).toEqual([{ level: 'warning', text: '有提交已等待评测 4 分 0 秒' }]);
    });

    it('measures judging time over the last 15 minutes, leaving rejudges out', () => {
        const data = snapshot([
            record('a', 80, 1, { judgeAt: at(80) + 10_000 }),
            record('b', 82, 2, { judgeAt: at(82) + 30_000 }),
            record('c', 20, 2, { judgeAt: at(85), rejudged: true }),
            record('d', 30, 1, { judgeAt: at(30) + 5_000 }), // judged an hour ago
        ]);
        expect(data.summary).toMatchObject({ judgedRecently: 2, averageLatencySeconds: 20, p95LatencySeconds: 30 });
    });

    it('raises system errors and judge machine problems', () => {
        const errors = [record('e1', 87, 8), record('e2', 88, 8), record('e3', 89, 10)];
        const data = snapshot(errors, [
            { mid: 'judge-1', updateAt: now - 30_000 },
            { mid: 'judge-2', updateAt: now - 10 * 60_000 },
            { mid: 'retired', updateAt: now - 2 * 86_400_000 },
        ]);
        expect(data.summary).toMatchObject({ systemErrors: 3, judgesOnline: 1 });
        expect(data.judges.map((judge) => [judge.mid, judge.online])).toEqual([['judge-1', true], ['judge-2', false]]);
        expect(data.alerts.map((alert) => alert.level)).toEqual(['warning', 'error']);
        expect(data.alerts[1].text).toBe('最近 5 分钟出现 3 次系统错误');
        expect(data.systemErrors.map((item) => item.id)).toEqual(['e3', 'e2', 'e1']);
        expect(snapshot([], []).alerts).toEqual([{ level: 'error', text: '没有在线的评测机' }]);
    });

    it('breaks results down per problem, counting a team once however many members solved it', () => {
        const data = snapshot([
            record('1', 10, 1, { uid: 2 }), record('2', 11, 1, { uid: 3 }), record('3', 12, 2, { uid: 1 }),
            record('4', 13, 7, { uid: 1, pid: 101, lang: 'py' }), record('5', 14, 9, { uid: 9, pid: 101, lang: 'py' }),
        ]);
        expect(data.perProblem).toEqual([
            { label: 'A', total: 3, counts: { AC: 2, WA: 1 }, solvedTeams: 1 },
            { label: 'B', total: 2, counts: { CE: 1, OTHER: 1 }, solvedTeams: 0 },
        ]);
        expect(data.languages).toEqual([{ lang: 'cc', count: 3 }, { lang: 'py', count: 2 }]);
        expect(data.systemErrors).toEqual([]);
    });

    it('counts submissions per minute over the last hour', () => {
        const data = snapshot([record('x', 31, 1), record('y', 31, 2), record('z', 89, 2), record('old', 5, 1)]);
        expect(data.timeline).toHaveLength(60);
        expect(data.timeline[0].minute).toBe(30);
        expect(data.timeline[1]).toEqual({ minute: 31, submitted: 2, accepted: 1 });
        expect(data.timeline.at(-1)).toEqual({ minute: 89, submitted: 1, accepted: 0 });
    });
});
