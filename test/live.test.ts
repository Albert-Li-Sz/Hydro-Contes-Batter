import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardData } from '../lib/board';
import { defaultSettings, normalizeSettings, type BoardSettings } from '../lib/settings';
import { resolverBoards } from '../lib/resolver-data';
import { buildContestInfo, buildRuns, contestStatus, type LiveSource } from '../lib/live/model';
import { computeScoreboard, ranking, runsByTeam, scoreboardDiff, statistics, timeline } from '../lib/live/scoreboard';
import { LiveHub, substituteTemplate } from '../lib/live/hub';
import { adminApi, defaultVisualConfig, overlayApi, overlayChannel, publicVisualConfig, storeName, type LiveStore } from '../lib/live/api';
import { QueueService } from '../lib/live/services';
import { demoData } from './fixture';

const minute = 60_000;
const begin = new Date('2026-11-15T01:00:00Z');
const end = new Date(begin.getTime() + 300 * minute);
const lock = new Date(begin.getTime() + 240 * minute);

function source(overrides: Partial<LiveSource> = {}, data: BoardData = demoData(), settings: BoardSettings = normalizeSettings({ ...defaultSettings, showIdentity: true, manualBoards: [] })): LiveSource {
    return {
        contest: { title: data.contest.contest_name, beginAt: begin, endAt: end, lockAt: lock },
        data, settings, identity: settings.showIdentity, logoNames: {}, now: begin.getTime() + 120 * minute,
        boards: resolverBoards(data, settings, settings.showIdentity),
        ...overrides,
    };
}

function withSubmissions(submissions: BoardData['submissions']): BoardData {
    return { ...demoData(), submissions };
}

describe('live contest model', () => {
    it('follows Hydro contest time, freeze and unlock', () => {
        const contest = { title: 't', beginAt: begin, endAt: end, lockAt: lock };
        expect(contestStatus(contest, begin.getTime() - 1).type).toBe('before');
        expect(contestStatus(contest, begin.getTime() + minute)).toEqual({ type: 'running', startedAtUnixMs: begin.getTime(), frozenAtUnixMs: null });
        expect(contestStatus(contest, lock.getTime() + 1)).toMatchObject({ type: 'running', frozenAtUnixMs: lock.getTime() });
        // Still frozen after the end until the contest is unlocked.
        expect(contestStatus(contest, end.getTime() + 1)).toMatchObject({ type: 'over', frozenAtUnixMs: lock.getTime() });
        expect(contestStatus({ ...contest, unlocked: true }, end.getTime() + 1)).toMatchObject({ type: 'finalized', frozenAtUnixMs: null });
    });

    it('builds teams, schools, groups and medal awards from the board settings', () => {
        const info = buildContestInfo(source());
        expect(info.problems.map((problem) => [problem.letter, problem.color])).toEqual([['A', '#e8794c'], ['B', '#3b82f6'], ['C', '#a855f7']]);
        expect(info.teams.find((team) => team.id === '4')).toMatchObject({ isOutOfContest: true, groups: ['unofficial'] });
        expect(info.groups.map((group) => group.id)).toEqual(expect.arrayContaining(['official', 'unofficial']));
        const school = info.organizations.find((org) => org.displayName === '南京晓庄学院')!;
        expect(info.teams.find((team) => team.id === '1')!.organizationId).toBe(school.id);
        expect(info.organizations.some((org) => org.displayName === '未填写学校')).toBe(true);
        expect(info.awardsSettings[0].awards.map((award) => [award.id, award.chainLimit])).toEqual([['gold-medal', 1], ['silver-medal', 3], ['bronze-medal', 6]]);
        expect(info.freezeTimeMs).toBe(240 * minute);
        expect(info.penaltyRoundingMode).toBe('sum_in_seconds');
    });

    it('hides names behind the identity rule', () => {
        const settings = normalizeSettings({ ...defaultSettings, showIdentity: false, manualBoards: [] });
        const info = buildContestInfo(source({}, demoData(), settings));
        expect(info.organizations).toEqual([]);
        expect(info.teams.every((team) => team.organizationId === null)).toBe(true);
    });

    it('turns frozen and pending runs into runs in progress and keeps penalty-free verdicts', () => {
        const data = withSubmissions([
            { submission_id: 'a', team_id: '1', problem_id: 0, timestamp: 1000, status: 'COMPILATION_ERROR' },
            { submission_id: 'b', team_id: '1', problem_id: 0, timestamp: 2000, status: 'REJECTED' },
            { submission_id: 'c', team_id: '1', problem_id: 0, timestamp: 3000, status: 'FROZEN' },
            { submission_id: 'd', team_id: '1', problem_id: 1, timestamp: 4000, status: 'CANCELED' },
        ]);
        const live = source({}, data);
        const built = buildRuns(live, buildContestInfo(live));
        expect(built.map((run) => run.result.type === 'ICPC' ? [run.result.verdict.shortName, run.result.verdict.isAddingPenalty] : run.result.type))
            .toEqual([['CE', false], ['RJ', true], 'IN_PROGRESS', ['IG', false]]);
    });

    it('marks first solves by the board rules: earliest accepted run among eligible teams', () => {
        const data = withSubmissions([
            { submission_id: 'u', team_id: '4', problem_id: 0, timestamp: 1000, status: 'CORRECT' }, // unofficial
            { submission_id: 'p', team_id: '2', problem_id: 1, timestamp: 1500, status: 'PENDING' },
            { submission_id: 'o', team_id: '1', problem_id: 0, timestamp: 2000, status: 'CORRECT' },
            { submission_id: 'q', team_id: '1', problem_id: 1, timestamp: 2500, status: 'CORRECT' },
            { submission_id: 'r', team_id: '1', problem_id: 0, timestamp: 3000, status: 'WRONG_ANSWER' },
        ]);
        const fts = (settings: BoardSettings) => {
            const live = source({}, data, settings);
            return buildRuns(live, buildContestInfo(live)).filter((run) => run.result.type === 'ICPC' && run.result.isFirstToSolveRun).map((run) => run.id);
        };
        expect(fts(normalizeSettings({ ...defaultSettings, manualBoards: [] }))).toEqual([]);
        // As on the board, a submission still being judged does not hold back a later accepted one.
        expect(fts(normalizeSettings({ ...defaultSettings, firstSolve: true, manualBoards: [] }))).toEqual(['o', 'q']);
        expect(fts(normalizeSettings({ ...defaultSettings, firstSolve: true, unofficialFirstSolve: true, manualBoards: [] }))).toEqual(['u', 'q']);
        const live = source({}, data);
        const after = buildRuns(live, buildContestInfo(live)).find((run) => run.id === 'r')!;
        expect(after.result.isAfterFirstOk).toBe(true);
    });
});

describe('live scoreboard', () => {
    it('ranks like Hydro: penalty in seconds, unofficial teams unranked, medals over official solvers', () => {
        const live = source();
        const info = buildContestInfo(live);
        const state = computeScoreboard(info, runsByTeam(buildRuns(live, info)), 'normal');
        const rank = (id: string) => state.ranking.ranks[state.ranking.order.indexOf(id)];
        expect(state.rows.get('1')).toMatchObject({ totalScore: 3, penalty: 600 + 1800 + 4200 });
        expect(rank('1')).toBe(1);
        expect(rank('4')).toBe(0);
        expect(state.ranking.order.at(-1)).toBe('8');
        const medal = (id: string) => state.ranking.awards.find((award) => award.id === id)!.teams;
        expect(medal('gold-medal')).toEqual(['1']);
        expect(medal('silver-medal')).toEqual(['3', '2']);
        // Team 8 solved nothing: no medal, and the unofficial teams never get one.
        for (const award of state.ranking.awards) expect(award.teams).not.toContain('8');
        for (const award of state.ranking.awards) expect(award.teams).not.toContain('4');
    });

    it('counts wrong attempts and pending runs per optimism level', () => {
        const data = withSubmissions([
            { submission_id: 'w', team_id: '1', problem_id: 0, timestamp: 60_000, status: 'WRONG_ANSWER' },
            { submission_id: 'c', team_id: '1', problem_id: 0, timestamp: 120_000, status: 'COMPILATION_ERROR' },
            { submission_id: 'p', team_id: '1', problem_id: 0, timestamp: 180_000, status: 'FROZEN' },
        ]);
        const live = source({}, data);
        const info = buildContestInfo(live);
        const byTeam = runsByTeam(buildRuns(live, info));
        const cell = (level: 'normal' | 'optimistic' | 'pessimistic') => computeScoreboard(info, byTeam, level).rows.get('1')!;
        expect(cell('normal').problemResults[0]).toMatchObject({ wrongAttempts: 1, pendingAttempts: 1, isSolved: false });
        expect(cell('optimistic')).toMatchObject({ totalScore: 1, penalty: 180 + 1200 });
        expect(cell('pessimistic').problemResults[0]).toMatchObject({ wrongAttempts: 2, pendingAttempts: 0, isSolved: false });
    });

    it('shares a rank on equal problems and penalty seconds, like the board', () => {
        const data: BoardData = {
            ...demoData(),
            submissions: [
                { submission_id: 'a', team_id: '1', problem_id: 0, timestamp: 600_000, status: 'CORRECT' },
                { submission_id: 'b', team_id: '2', problem_id: 1, timestamp: 600_900, status: 'CORRECT' }, // same whole second
                { submission_id: 'c', team_id: '3', problem_id: 2, timestamp: 601_000, status: 'CORRECT' },
            ],
        };
        const live = source({}, data);
        const info = buildContestInfo(live);
        const state = computeScoreboard(info, runsByTeam(buildRuns(live, info)), 'normal');
        const rank = (id: string) => state.ranking.ranks[state.ranking.order.indexOf(id)];
        expect([rank('1'), rank('2'), rank('3')]).toEqual([1, 1, 3]);
    });

    it('sends changed rows only after the first snapshot, and statistics and timelines', () => {
        const live = source();
        const info = buildContestInfo(live);
        const runs = buildRuns(live, info);
        const before = computeScoreboard(info, runsByTeam(runs), 'normal');
        const extra = { id: 'x', result: { type: 'ICPC' as const, verdict: { shortName: 'AC', isAccepted: true, isAddingPenalty: false }, isFirstToSolveRun: false, isAfterFirstOk: false },
            problemId: '2', teamId: '8', time: 9_000_000, languageId: null, reactionVideos: [], isHidden: false };
        const after = computeScoreboard(info, runsByTeam([...runs, extra]), 'normal');
        expect(Object.keys(scoreboardDiff(before).rows)).toHaveLength(info.teams.length);
        expect(Object.keys(scoreboardDiff(after, before).rows)).toEqual(['8']);
        expect(statistics(info, after).stats[2]).toEqual({ success: 6, wrong: 0, pending: 0 });
        expect(timeline([extra, { ...extra, id: 'y', time: 9_100_000 }])).toHaveLength(1);
        expect(ranking(info, after.rows).order).toEqual(after.ranking.order);
    });
});

describe('live queue', () => {
    it('keeps history out of the queue at start-up and shows new runs', () => {
        const live = source();
        const info = buildContestInfo(live);
        const queue = new QueueService();
        const events: any[] = [];
        queue.subscribe((event) => events.push(event));
        const now = begin.getTime() + 120 * minute;
        for (const run of buildRuns(live, info)) queue.onRun(run, info, now);
        expect(events.filter((event) => event.type === 'AddRunToQueue')).toHaveLength(0);
        const fresh = { id: 'n', result: { type: 'IN_PROGRESS' as const, testedPart: 0, isAfterFirstOk: false }, problemId: '0', teamId: '2', time: 120 * minute - 5000, languageId: null, reactionVideos: [], isHidden: false };
        queue.onRun(fresh, info, now + 2 * minute);
        expect(events.at(-1)).toMatchObject({ type: 'AddRunToQueue', info: { id: 'n' } });
        queue.onRun({ ...fresh, result: { type: 'ICPC', verdict: { shortName: 'AC', isAccepted: true, isAddingPenalty: false }, isFirstToSolveRun: false, isAfterFirstOk: false } }, info, now + 2 * minute + 1000);
        expect(events.at(-1)).toMatchObject({ type: 'ModifyRunInQueue', info: { id: 'n', result: { type: 'ICPC' } } });
        queue.clean(info, now + 10 * minute);
        expect(events.at(-1)).toMatchObject({ type: 'RemoveRunFromQueue', info: { id: 'n' } });
    });
});

function memoryStore(): LiveStore & { saved: Map<string, Buffer> } {
    let visual = defaultVisualConfig('demo');
    const saved = new Map<string, Buffer>();
    return {
        saved,
        visualConfig: async () => visual,
        saveVisualConfig: async (value) => { visual = value; },
        mediaNames: async () => ['lower_third_icpc_left.svg', ...saved.keys()],
        saveMedia: async (name, data) => { saved.set(name, data); },
    };
}

function makeHub(state = {}, persist = vi.fn(async (_state: unknown) => {})) {
    let live = source();
    const hub = new LiveHub({
        load: async () => live,
        persist,
        template: async (name) => (name === 'title.svg' ? '<svg><text>{name}</text><text>{team.name}</text><text>{!raw}</text></svg>' : null),
        idleMs: 0,
    }, state);
    return { hub, persist, set: (next: LiveSource) => { live = next; } };
}

const request = (method: string, subpath: string, body: unknown = {}, query: Record<string, string> = {}) => ({
    method, subpath, body, query, querystring: new URLSearchParams(query).toString(), files: [], user: 'director',
});

describe('live hub and admin api', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('shows and hides widgets on the main screen and tells every console', async () => {
        const { hub } = makeHub();
        await hub.ready;
        await hub.refresh();
        const screen: any[] = [];
        const actions: any[] = [];
        hub.subscribe('mainScreen', (event) => screen.push(event));
        hub.subscribe('adminActions', (event) => actions.push(event));
        const store = memoryStore();
        expect(screen[0]).toEqual({ type: 'MainScreenSnapshot', widgets: [] });
        expect(JSON.parse((await adminApi(hub, store, request('POST', 'scoreboard/show_with_settings', { optimismLevel: 'optimistic', group: 'official' })))!.body))
            .toEqual({ status: 'ok', response: null });
        expect(screen.at(-1)).toMatchObject({ type: 'ShowWidget', widget: { type: 'ScoreboardWidget', widgetId: 'scoreboard', settings: { optimismLevel: 'optimistic', group: 'official', scrollDirection: 'Forward' } } });
        expect(actions).toEqual(['/api/admin/scoreboard/show_with_settings']);
        expect(JSON.parse((await adminApi(hub, store, request('GET', 'scoreboard')))!.body)).toMatchObject({ shown: true, id: null });
        await adminApi(hub, store, request('POST', 'scoreboard/hide'));
        expect(screen.at(-1)).toEqual({ type: 'HideWidget', id: 'scoreboard' });
        const bad = (await adminApi(hub, store, request('POST', 'queue', { horizontal: 'yes' })))!;
        expect(bad.status).toBe(400);
        expect(JSON.parse(bad.body).status).toBe('error');
        expect(await adminApi(hub, store, request('GET', 'nothing/here'))).toBeNull();
        expect(JSON.parse((await adminApi(hub, store, request('GET', 'scoreboard/regions')))!.body).map((group: any) => group.id)).toContain('unofficial');
        hub.dispose();
    });

    it('runs presets with a time to live, and the ticker', async () => {
        vi.useFakeTimers();
        const { hub } = makeHub();
        await hub.ready;
        const ticker: any[] = [];
        hub.subscribe('ticker', (event) => ticker.push(event));
        const store = memoryStore();
        const created = JSON.parse((await adminApi(hub, store, request('POST', 'tickerMessage', { type: 'text', part: 'long', periodMs: 30000, text: '欢迎' })))!.body);
        await adminApi(hub, store, request('POST', `tickerMessage/${created.response}/show`));
        expect(ticker.at(-1)).toMatchObject({ type: 'AddMessage', message: { settings: { type: 'text', text: '欢迎' } } });
        expect(ticker.at(-1).message.id).toMatch(/^ticker_text-\d+$/);
        const screen: any[] = [];
        hub.subscribe('mainScreen', (event) => screen.push(event));
        await adminApi(hub, store, request('POST', 'advertisement/create_and_show_with_ttl', { text: '茶歇' }, { ttl: '5000' }));
        expect(screen.at(-1)).toMatchObject({ type: 'ShowWidget', widget: { type: 'AdvertisementWidget', advertisement: { text: '茶歇' } } });
        vi.advanceTimersByTime(5001);
        expect(screen.at(-1)).toMatchObject({ type: 'HideWidget' });
        expect(JSON.parse((await adminApi(hub, store, request('GET', 'advertisement')))!.body)).toEqual([]);
        expect((await adminApi(hub, store, request('POST', 'advertisement/create_and_show_with_ttl', { text: 'x' })))!.status).toBe(400);
        hub.dispose();
    });

    it('renders titles from templates with escaping and team data', async () => {
        const { hub } = makeHub();
        await hub.ready;
        await hub.refresh();
        const store = memoryStore();
        const id = JSON.parse((await adminApi(hub, store, request('POST', 'title', { preset: 'title.svg', data: { name: '<b>主持人</b>', teamId: '1', raw: '<tspan/>' } })))!.body).response;
        const preview = JSON.parse((await adminApi(hub, store, request('GET', `title/${id}/preview`)))!.body).response;
        const svg = Buffer.from(preview.content.split('base64,')[1], 'base64').toString('utf8');
        expect(svg).toBe('<svg><text>&lt;b&gt;主持人&lt;/b&gt;</text><text>林澈</text><text><tspan/></text></svg>');
        expect((await adminApi(hub, store, request('POST', 'title', { preset: 'missing.svg', data: {} })))!.status).toBe(400);
        expect(substituteTemplate('{a.b} {unknown}', { a: { b: 'x&y' } })).toBe('x&amp;y {unknown}');
        hub.dispose();
    });

    it('persists widget state and restores it', async () => {
        vi.useFakeTimers();
        const persist = vi.fn(async (_state: unknown) => {});
        const { hub } = makeHub({}, persist);
        await hub.ready;
        await hub.refresh();
        const store = memoryStore();
        await adminApi(hub, store, request('POST', 'queue/show'));
        await adminApi(hub, store, request('POST', 'picture', { url: '/m/a.png', name: 'a' }));
        vi.advanceTimersByTime(600);
        const saved = persist.mock.calls.at(-1)![0] as any;
        expect(saved.controllers.queue.showOrder).toBeGreaterThan(0);
        expect(saved.presets.picture).toEqual([{ settings: { url: '/m/a.png', name: 'a' }, showOrder: null, id: 1, expiresAt: null }]);
        hub.dispose();
        const restored = makeHub(saved).hub;
        await restored.ready;
        const screen: any[] = [];
        restored.subscribe('mainScreen', (event) => screen.push(event));
        expect(screen[0].widgets.map((item: any) => item.widget.type)).toEqual(['QueueWidget']);
        expect(JSON.parse((await adminApi(restored, store, request('GET', 'picture')))!.body)).toEqual([{ shown: false, settings: { url: '/m/a.png', name: 'a' }, id: 1 }]);
        restored.dispose();
    });

    it('streams scoreboard diffs, statistics and analytics as data changes', async () => {
        const { hub, set } = makeHub();
        await hub.ready;
        await hub.refresh();
        const diffs: any[] = [];
        const analytics: any[] = [];
        hub.subscribe('scoreboard:normal', (event) => diffs.push(event));
        hub.subscribe('analytics', (event) => analytics.push(event));
        expect(Object.keys(diffs[0].rows)).toHaveLength(8);
        const data = demoData();
        data.submissions.push({ submission_id: 'new', team_id: '8', problem_id: 0, timestamp: 100 * minute, status: 'CORRECT' });
        set(source({}, data));
        await hub.refresh();
        expect(Object.keys(diffs.at(-1).rows)).toEqual(['8']);
        const message = analytics.filter((event) => event.type === 'UpdateAnalyticsMessage').at(-1).message;
        expect(message).toMatchObject({ id: 'new', teamId: '8', tags: expect.arrayContaining(['submission', 'accepted']) });
        expect(message.comments[0].message).toMatch(/^陆川 通过 A 题/);
        const store = memoryStore();
        await adminApi(hub, store, request('POST', `analytics/new/${message.comments[0].id}/tickerMessage`, {}, { ttl: '10000' }));
        const ticker = JSON.parse((await adminApi(hub, store, request('GET', 'tickerMessage')))!.body);
        // Listed while it lasts (like upstream), and saved with its expiry for the other Hydro processes.
        expect(ticker).toEqual([{ shown: true, id: expect.any(Number), settings: expect.objectContaining({ type: 'text', text: message.comments[0].message }) }]);
        expect(hub.state().presets!.tickerMessage).toEqual([expect.objectContaining({ id: ticker[0].id, expiresAt: expect.any(Number) })]);
        hub.dispose();
    });

    it('serves the overlay api and validates the visual config', async () => {
        const { hub } = makeHub();
        await hub.ready;
        const store = memoryStore();
        expect(overlayChannel('scoreboard/optimistic')).toBe('scoreboard:optimistic');
        expect(overlayChannel('teamRuns/12')).toBe('teamRuns:12');
        expect(overlayChannel('scoreboard/other')).toBeNull();
        expect(overlayChannel('../secret')).toBeNull();
        const visual = await overlayApi(hub, 'visualConfig.json', await store.visualConfig());
        expect(JSON.parse(visual!.body)).toMatchObject({ QUEUE_TITLE: '评测队列', SCOREBOARD_STANDINGS_NAME: '' });
        const info = JSON.parse((await overlayApi(hub, 'contestInfo', '{}'))!.body);
        expect(info.teams).toHaveLength(8);
        expect((await adminApi(hub, store, request('POST', 'visualConfig', '[1]')))!.status).toBe(400);
        expect((await adminApi(hub, store, request('POST', 'visualConfig', '{"CONTEST_COLOR":"#123456"}')))!.status).toBe(200);
        expect((await adminApi(hub, store, request('GET', 'visualConfig')))!.body).toBe('{"CONTEST_COLOR":"#123456"}');
        expect((await adminApi(hub, store, {
            ...request('POST', 'media/upload'),
            files: [{ name: '../evil name.html', size: 10, read: async () => Buffer.from('x') }],
        }))!.status).toBe(400);
        expect((await adminApi(hub, store, {
            ...request('POST', 'media/upload'),
            files: [{ name: '校徽 logo.png', size: 3, read: async () => Buffer.from('png') }],
        }))!.body).toBe(JSON.stringify({ status: 'ok', response: ['校徽_logo.png'] }));
        hub.dispose();
    });
});

describe('live consistency with the board', () => {
    it('orders and ranks teams with the board rule (standings.js compareStandings)', async () => {
        const { compareStandings } = await import('../resolver/public/js/standings.js');
        const data = withSubmissions([
            { submission_id: 'a', team_id: '1', problem_id: 0, timestamp: 600_000, status: 'CORRECT' },
            { submission_id: 'b', team_id: '2', problem_id: 0, timestamp: 300_000, status: 'CORRECT' },
            { submission_id: 'c', team_id: '2', problem_id: 1, timestamp: 300_000, status: 'WRONG_ANSWER' },
            { submission_id: 'd', team_id: '3', problem_id: 1, timestamp: 600_000, status: 'CORRECT' },
            { submission_id: 'e', team_id: '5', problem_id: 2, timestamp: 900_000, status: 'CORRECT' },
        ]);
        const live = source({}, data);
        const info = buildContestInfo(live);
        const state = computeScoreboard(info, runsByTeam(buildRuns(live, info)), 'normal');
        const records = info.teams.map((team) => ({
            teamId: team.id, sortName: team.name, solved: state.rows.get(team.id)!.totalScore, timeSeconds: state.rows.get(team.id)!.penalty,
        })).sort((a, b) => compareStandings({ scoringMode: 'hydro' }, a, b));
        expect(state.ranking.order).toEqual(records.map((record) => record.teamId));
        // 1 and 3: one problem in 600 s each, a tie whatever the last accepted time.
        const rank = (id: string) => state.ranking.ranks[state.ranking.order.indexOf(id)];
        expect([rank('2'), rank('1'), rank('3'), rank('5')]).toEqual([1, 2, 2, 4]);
    });

    it('awards tied medals by rank, or by position when tied teams do not share a medal', () => {
        const data = withSubmissions([
            { submission_id: 'a', team_id: '1', problem_id: 0, timestamp: 600_000, status: 'CORRECT' },
            { submission_id: 'b', team_id: '2', problem_id: 0, timestamp: 600_000, status: 'CORRECT' },
            { submission_id: 'c', team_id: '3', problem_id: 0, timestamp: 700_000, status: 'CORRECT' },
        ]);
        const medals = (medalSameScore: boolean) => {
            const settings = normalizeSettings({ ...defaultSettings, medals: { gold: 1, silver: 1, bronze: 0 }, medalSameScore, manualBoards: [] });
            const live = source({}, data, settings);
            const info = buildContestInfo(live);
            const { awards, order } = computeScoreboard(info, runsByTeam(buildRuns(live, info)), 'normal').ranking;
            return { order, ...Object.fromEntries(awards.map((award) => [award.id, award.teams])) };
        };
        // Shared rank 1: both gold; silver covers rank 2 only, so the team ranked 3rd gets none (as on the board).
        expect(medals(true)).toMatchObject({ 'gold-medal': expect.arrayContaining(['1', '2']), 'silver-medal': [] });
        const strict = medals(false);
        expect(strict).toMatchObject({ 'gold-medal': [strict.order[0]], 'silver-medal': [strict.order[1]] });
    });

    it('states the rank of the time in commentary, also for history loaded later', async () => {
        const data = withSubmissions([
            { submission_id: 'early', team_id: '8', problem_id: 0, timestamp: 60_000, status: 'CORRECT' },
            { submission_id: 'later', team_id: '1', problem_id: 0, timestamp: 30_000, status: 'CORRECT' },
            { submission_id: 'more', team_id: '1', problem_id: 1, timestamp: 90_000, status: 'CORRECT' },
        ]);
        const hub = new LiveHub({ load: async () => source({}, data), persist: async () => {}, template: async () => null, idleMs: 0 });
        await hub.refresh();
        const comment = (id: string) => hub.analytics.list().find((message) => message.id === id)!.comments[0].message;
        expect(comment('early')).toBe('陆川 通过 A 题，共通过 1 题，当前排名第 2');
        expect(comment('more')).toBe('林澈 通过 B 题，共通过 2 题，当前排名第 1');
        hub.dispose();
    });
});

describe('live fixes', () => {
    it('reloads state saved elsewhere in place, without replaying shown items', async () => {
        const { hub } = makeHub();
        await hub.ready;
        const store = memoryStore();
        await adminApi(hub, store, request('POST', 'advertisement', { text: '欢迎' }));
        await adminApi(hub, store, request('POST', 'advertisement/1/show'));
        const screen: any[] = [];
        hub.subscribe('mainScreen', (event) => screen.push(event));
        const saved = hub.state();
        await hub.reload(saved);
        expect(screen).toHaveLength(1); // snapshot only: nothing hidden or shown again
        await hub.reload({ ...saved, presets: { ...saved.presets, advertisement: [{ ...saved.presets!.advertisement![0], settings: { text: '茶歇' } }] } });
        expect(screen.at(-1)).toMatchObject({ type: 'ShowWidget', widget: { advertisement: { text: '茶歇' } } });
        await hub.reload({ ...saved, presets: { ...saved.presets, advertisement: [] } });
        expect(screen.at(-1)).toMatchObject({ type: 'HideWidget' });
        expect(JSON.parse((await adminApi(hub, store, request('POST', 'advertisement', { text: 'x' })))!.body).response).toBe(2);
        hub.dispose();
    });

    it('keeps file names readable, backend addresses fixed and the clock on the server', async () => {
        expect(storeName('校徽 2026.png')).toBe('校徽_2026.png');
        expect(storeName('../队徽.svg')).toBe('__队徽.svg');
        expect(storeName('a<b>.svg')).toBe('a_b_.svg');
        const { hub } = makeHub();
        const store = memoryStore();
        const rejected = (await adminApi(hub, store, request('POST', 'visualConfig', '{"BASE_URL_WS":"wss://evil.example"}')))!;
        expect([rejected.status, JSON.parse(rejected.body).message]).toEqual([400, expect.stringContaining('BASE_URL_WS')]);
        expect(publicVisualConfig('{"BASE_URL_BACKEND":"x","CONTEST_COLOR":"#111"}')).toEqual({ CONTEST_COLOR: '#111' });
        const time = JSON.parse((await overlayApi(hub, 'serverTime', '{}'))!.body).now;
        expect(Math.abs(time - Date.now())).toBeLessThan(1000);
        hub.dispose();
    });

    it('withholds teams until the board is public', () => {
        const live = source({ hidden: true });
        const info = buildContestInfo(live);
        expect([info.teams, info.organizations, buildRuns(live, info)]).toEqual([[], [], []]);
        expect(info.groups.map((group) => group.id)).toEqual(['official', 'unofficial']);
        expect(info.problems).toHaveLength(3);
    });
});

describe('live sub-boards and processes', () => {
    it('ranks and medals each sub-board on its own, with its own medal settings', () => {
        const settings = normalizeSettings({
            ...defaultSettings, showIdentity: true, schoolBoards: true,
            manualBoards: [{ id: 'pair', name: '两队榜', teamIds: ['2', '5'] }],
            boardAwards: { 'manual-pair': { medals: { gold: 1, silver: 0, bronze: 0 } } },
        });
        const live = source({}, demoData(), settings);
        const info = buildContestInfo(live);
        const state = computeScoreboard(info, runsByTeam(buildRuns(live, info)), 'normal');
        const diff = scoreboardDiff(state);
        const pair = diff.hydroGroups['manual-pair'];
        // Within the pair: team 2 (2 solved, 3600 s) ahead of team 5 (2 solved, 4200 s).
        expect(pair.ranks).toEqual({ 2: 1, 5: 2 });
        expect(pair.awards).toEqual([{ id: 'gold-medal', citation: '金奖', teams: ['2'] }]);
        // Overall team 2 ranks 3rd and gets silver: the sub-board view must not show that.
        expect(diff.ranks[diff.order.indexOf('2')]).toBe(3);
        expect(diff.hydroGroups.unofficial.ranks).toEqual({});
        expect(info.awardsSettings.find((chain) => chain.groups?.[0] === 'manual-pair')?.awards.map((award) => award.chainLimit)).toEqual([1]);
    });

    it('tells local consoles what another process changed, and shares templates, scores and marks', async () => {
        const announced: [string, unknown][] = [];
        let template = '<svg>{name} v1</svg>';
        const hub = new LiveHub({
            load: async () => source(), persist: async () => {}, idleMs: 0,
            template: async () => template,
            announce: (kind, payload) => { announced.push([kind, payload]); },
        });
        await hub.refresh();
        const actions: string[] = [];
        hub.subscribe('adminActions', (uri) => actions.push(uri as string));
        await hub.reload({ controllers: { 'teamView/PVP_TOP': { settings: { teamId: '1' }, showOrder: 3 }, queue: { settings: {}, showOrder: null } }, presets: { picture: [{ id: 4, settings: { url: '/a.png', name: 'a' }, showOrder: null }] } });
        expect(actions).toEqual(['/api/admin/teamPVP/PVP_TOP', '/api/admin/picture']);
        expect(announced).toEqual([]); // applying another process's state is not announced again

        const store = memoryStore();
        const id = JSON.parse((await adminApi(hub, store, request('POST', 'title', { preset: 'cap.svg', data: { name: '主持' } })))!.body).response;
        await adminApi(hub, store, request('POST', `title/${id}/show`));
        const screen: any[] = [];
        hub.subscribe('mainScreen', (event) => screen.push(event));
        template = '<svg>{name} v2</svg>';
        await hub.templateChanged('cap.svg', true);
        const svg = Buffer.from(screen.at(-1).widget.content.split('base64,')[1], 'base64').toString();
        expect(svg).toBe('<svg>主持 v2</svg>');

        hub.addScores([{ teamId: '3', score: 7 }]);
        expect(hub.spotlight.score('3')).toBe(7);
        expect(announced.at(-1)).toEqual(['spotlight', [{ teamId: '3', score: 7 }]]);
        hub.addScores([{ teamId: '3', score: 1 }], true);
        expect(announced.filter(([kind]) => kind === 'spotlight')).toHaveLength(1);

        const message = hub.analytics.list()[0];
        await adminApi(hub, store, request('POST', `analytics/${message.id}/${message.comments[0].id}/advertisement`, {}, { ttl: '60000' }));
        expect(announced.at(-1)).toEqual(['mark', expect.objectContaining({ messageId: message.id, field: 'advertisement', value: expect.objectContaining({ presetId: expect.any(Number) }) })]);
        hub.applyMark({ messageId: message.id, commentId: message.comments[0].id, field: 'advertisement', value: null });
        expect(hub.analytics.list()[0].comments[0].advertisement).toBeNull();
        hub.dispose();
    });

    it('lets the director see the teams before the start while the overlay does not', async () => {
        const hub = new LiveHub({ load: async () => source({ hidden: true }), persist: async () => {}, template: async () => null, idleMs: 0 });
        await hub.refresh();
        expect(hub.info!.teams).toEqual([]);
        expect(hub.teams()).toHaveLength(8);
        expect(hub.regions().map((group) => group.id)).toContain('official');
        const seen: any[] = [];
        hub.subscribe('admin:contestInfo', (info) => seen.push(info));
        hub.subscribe('contestInfo', (info) => seen.push(info));
        expect(seen.map((info) => info.teams.length)).toEqual([8, 0]);
        hub.dispose();
    });
});
