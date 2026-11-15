import { describe, expect, it } from 'vitest';
import { hostPressure, judgePressure } from '../lib/host';

const now = Date.UTC(2026, 10, 16, 3, 0, 0);
const gb = 1024 ** 3;

describe('machine pressure', () => {
    it('samples this server: CPU share, memory in use and the process', () => {
        const host = hostPressure();
        expect(host.cores).toBeGreaterThan(0);
        expect(host.memoryTotal).toBeGreaterThan(0);
        expect(host.memoryRate).toBeGreaterThanOrEqual(0);
        expect(host.memoryRate).toBeLessThanOrEqual(100);
        expect(host.processRss).toBeGreaterThan(0);
        if (process.platform !== 'win32') expect(host.load).toHaveLength(3);
    });

    it('reads judge reports, busiest first, and forgets machines silent for hours', () => {
        const judges = judgePressure([
            { mid: 'judge-a', type: 'judge', updateAt: new Date(now - 4 * 60_000), memory: { total: 16 * gb, active: 4 * gb }, load: { currentLoad: 31.26 } },
            { mid: 'judge-b', type: 'judge', updateAt: new Date(now - 60_000), memory: { total: 8 * gb, available: 1 * gb }, load: { currentLoad: 12 } },
            { mid: 'old', type: 'judge', updateAt: new Date(now - 7 * 3600_000), memory: { total: 8 * gb, active: gb } },
            { mid: 'server-2', type: 'server', updateAt: new Date(now - 600_000) }, // the built-in judge on another server
            { type: 'judge' },
        ], now, null);
        expect(judges).toEqual([
            { name: 'judge-b', kind: 'remote', cpu: 12, memoryRate: 87.5, memoryTotal: 8 * gb, reportedSecondsAgo: 60 },
            { name: 'judge-a', kind: 'remote', cpu: 31.3, memoryRate: 25, memoryTotal: 16 * gb, reportedSecondsAgo: 240 },
            { name: '内置评测 server-2', kind: 'builtin', cpu: null, memoryRate: null, memoryTotal: null, reportedSecondsAgo: 600 },
        ]);
    });

    it('lists the built-in judge on this server with the live numbers, leaving other servers out', () => {
        const host = { ...hostPressure(), cpu: 40, memoryRate: 50 };
        const judges = judgePressure([
            { mid: 'server-1', type: 'server', updateAt: new Date(now) },
            { mid: 'judge-a', type: 'judge', updateAt: new Date(now), load: { currentLoad: 90 } },
        ], now, host);
        expect(judges.map((judge) => [judge.name, judge.kind, judge.cpu])).toEqual([['内置评测（本机）', 'local', 40], ['judge-a', 'remote', 90]]);
    });
});
