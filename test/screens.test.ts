import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../lib/settings';
import { resolverBoards } from '../lib/resolver-data';
import { defaultScreenConfig, normalizeScreenConfig, presentationItem, screenData } from '../lib/screens-data';
import { demoData } from './fixture';

const settings = { ...defaultSettings, showIdentity: true, manualBoards: [{ id: 'mixed', name: '混合榜', teamIds: ['1', '4', '7'] }] };
const env = { logoNames: { 南京晓庄学院: '0123456789ab' }, locked: true, firstSolve: true, unofficialFirstSolve: false };
const highlighted = (result: ReturnType<typeof screenData>) => Object.entries(result.results)
    .flatMap(([id, cells]) => cells.map((cell: any, index: number) => (cell.firstToSolve ? `${id}:${index}` : null))).filter(Boolean);

describe('big-screen configuration', () => {
    it('starts from usable defaults and keeps earlier values for omitted fields', () => {
        const base = defaultScreenConfig();
        expect(base.items.tiles.variant).toBe('standings');
        expect(base.items.queue).toMatchObject({ variant: 'queue', boardId: 'all' });
        expect(normalizeScreenConfig({ items: { queue: { variant: 'teams' } } }).items.queue.variant).toBe('teams');
        // Settings saved before the queue screen existed still load, with its defaults.
        const { queue: _queue, ...older } = base.items;
        expect(normalizeScreenConfig({ locale: 'zh-CN', items: older }).items.queue.variant).toBe('queue');
        expect(base.items.countdown).toMatchObject({ variant: 'digital', target: 'end' });
        const next = normalizeScreenConfig({ locale: 'en', items: { tiles: { variant: 'rank' }, message: { text: '午餐时间' } } }, base);
        expect(next.locale).toBe('en');
        expect(next.items.tiles).toMatchObject({ variant: 'rank', boardId: 'all' });
        expect(normalizeScreenConfig({ items: { scoreboard: { boardId: 'manual-mixed' } } }, next).items.message.text).toBe('午餐时间');
    });
    it('rejects invalid values', () => {
        for (const bad of [null, [], { locale: 'fr' }, { items: { tiles: { variant: 'map' } } }, { items: { scoreboard: { boardId: '../x' } } },
            { items: { message: { text: 'x'.repeat(2001) } } }, { items: { resolver: { sessionId: 'abc' } } },
            { items: { countdown: { target: 'custom' } } }, { items: { countdown: { targetTime: 'soon' } } }]) {
            expect(() => normalizeScreenConfig(bad)).toThrow();
        }
    });
    it('resolves the countdown target from the contest or the chosen time', () => {
        const data = demoData();
        const config = defaultScreenConfig();
        expect(presentationItem('countdown', config.items.countdown, data).targetTime).toBe(data.contest.end_time * 1000);
        const custom = normalizeScreenConfig({ items: { countdown: { target: 'custom', targetTime: '2026-10-27T03:00:00Z' } } });
        expect(presentationItem('countdown', custom.items.countdown, data)).toMatchObject({ type: 'countdown', variant: 'digital', targetTime: Date.parse('2026-10-27T03:00:00Z') });
        expect(presentationItem('scoreboard', config.items.scoreboard, data)).toEqual({ type: 'scoreboard' });
        expect(presentationItem('queue', config.items.queue, data)).toEqual({ type: 'queue', variant: 'queue' });
    });
});

describe('big-screen data', () => {
    it('follows the board first-solve rules for highlights and the first-solves list', () => {
        const data = demoData();
        expect(highlighted(screenData(data, null, env))).toEqual(['1:0', '5:1', '7:2']);
        expect(highlighted(screenData(data, null, { ...env, firstSolve: false }))).toEqual([]);
        // Starred 苏禾 (4) solves A first: only listed and highlighted when starred participants may win it.
        const early = demoData();
        early.submissions.push({ submission_id: 'early', team_id: '4', problem_id: 0, timestamp: 60000, status: 'CORRECT' });
        expect(screenData(early, null, env).firstSolves.map((row: any) => row.teamId)).toEqual(['1', '5', '7']);
        expect(highlighted(screenData(early, null, env))).toContain('1:0');
        const allowed = screenData(early, null, { ...env, unofficialFirstSolve: true });
        expect(allowed.firstSolves.map((row: any) => row.teamId)).toEqual(['4', '5', '7']);
        expect(highlighted(allowed)).toContain('4:0');
    });
    it('limits a board to its members and shows starred participants with a star rank', () => {
        const data = demoData();
        const board = resolverBoards(data, settings, true).find((item) => item.id === 'manual-mixed')!;
        const result = screenData(data, new Set(board.teamIds), env);
        expect(result.contest.teams.map((team: { id: string }) => team.id).sort()).toEqual(['1', '4', '7']);
        expect(result.standings.find((row) => row.teamId === '4')?.rank).toBe('*');
        expect(result.standings.find((row) => row.teamId === '1')?.rank).toBe(1);
        expect(result.contest.teams.find((team: { id: string }) => team.id === '1').logo).toBe('/hydro-resolver/logos/0123456789ab.webp');
        expect(result.contest.teams.every((team: { logo: string }) => team.logo.startsWith('/hydro-resolver/'))).toBe(true);
    });
    it('keeps frozen results pending and computes first solves from visible results only', () => {
        const data = demoData();
        data.contest.frozen_time = 3600;
        data.submissions.push({ submission_id: 'late', team_id: '8', problem_id: 0, timestamp: 4 * 3600 * 1000 + 60000, status: 'FROZEN' });
        const result = screenData(data, null, env);
        expect(result.frozen).toBe(true);
        expect(result.results['8'][0]).toMatchObject({ status: 'pending' });
        expect(result.firstSolves.map((row: any) => row.teamId)).not.toContain('8');
        expect(result.stats.submissions.length % 7).toBe(0);
        // The queue reads these: a judging or frozen submission is code 2, never its hidden verdict.
        expect(result.stats.submissions.slice(-7)[3]).toBe(2);
        expect(result.contest.submissions.at(-1)).toMatchObject({ id: 'late', status: 'pending' });
        expect(result.clock.startTime).toBe(new Date(data.contest.start_time * 1000).toISOString());
    });
});

describe('big-screen clocks', () => {
    it('keep the full hour count for multi-day contests instead of wrapping at 48 hours', async () => {
        const { formatTime } = await import('../resolver/public/js/render/java-contest.js');
        expect(formatTime((95 * 3600 + 59 * 60 + 59) * 1000, true)).toBe('95:59:59');
        expect(formatTime(-((50 * 3600) * 1000), true)).toBe('-50:00:00');
        expect(formatTime(-59000, true)).toBe('-0:00:59');
    });
});
