// Big-screen data for the ICPC Tools presentation ports bundled from Resolver-Web v1.4.0.
// The projection below follows Resolver-Web server/platform/model.js publicContest() and
// presentationStats() (Apache-2.0 / ICPC Software License, see licenses/), adapted to read the
// plugin's already freeze-masked public board instead of a CCS event feed.
import type { BoardData } from './board';
import { resolverAssetBase } from './resolver-data';
import { computeCells, normalizeContest } from '../resolver/server/lib/engine.js';

export const screenTypes = ['scoreboard', 'leaders', 'tiles', 'first-solves', 'queue', 'clock', 'countdown', 'message', 'resolver'] as const;
export type ScreenType = typeof screenTypes[number];
export const standingsTypes = new Set<ScreenType>(['scoreboard', 'leaders', 'tiles', 'first-solves', 'queue']);

export interface ScreenItem {
    boardId: string;
    variant: string;
    target: 'end' | 'start' | 'custom';
    targetTime: string | null;
    text: string;
    sessionId: string;
}
export interface ScreenConfig {
    locale: 'zh-CN' | 'en';
    items: Record<ScreenType, ScreenItem>;
}

export const screenLabels: Record<ScreenType, string> = {
    scoreboard: '实时榜单', leaders: '领先队伍榜', tiles: '方块榜', 'first-solves': '首解列表', queue: '判题队列',
    clock: '比赛时钟', countdown: '倒计时', message: '文字公告', resolver: '滚榜观众画面',
};
export const screenVariants: Partial<Record<ScreenType, [string, string][]>> = {
    tiles: [['standings', '实时方块榜（Tiles）'], ['rank', '按通过数分组（Tile rank）'], ['list', '按队名排列（Tile list）']],
    queue: [['queue', '判题队列（Judge queue）'], ['teams', '队伍判题（Team judgements）']],
    countdown: [['digital', '数字倒计时'], ['polar', '环形倒计时']],
};

export class ScreenError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

const blankItem = (): ScreenItem => ({ boardId: 'all', variant: '', target: 'end', targetTime: null, text: '', sessionId: '' });
export function defaultScreenConfig(): ScreenConfig {
    const items = Object.fromEntries(screenTypes.map((type) => [type, {
        ...blankItem(), variant: screenVariants[type]?.[0][0] || '',
    }])) as Record<ScreenType, ScreenItem>;
    items.message.text = '比赛进行中';
    return { locale: 'zh-CN', items };
}

/** Validate an administrator's saved configuration; unknown fields are dropped. */
export function normalizeScreenConfig(raw: unknown, base = defaultScreenConfig()): ScreenConfig {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ScreenError('大屏配置格式无效');
    const input = raw as Record<string, any>;
    const config = structuredClone(base);
    if (input.locale !== undefined) {
        if (!['zh-CN', 'en'].includes(input.locale)) throw new ScreenError('大屏语言无效');
        config.locale = input.locale;
    }
    for (const type of screenTypes) {
        const item = input.items?.[type];
        if (item === undefined) continue;
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ScreenError(`${screenLabels[type]}配置无效`);
        const next = config.items[type];
        if (item.boardId !== undefined) {
            if (typeof item.boardId !== 'string' || !/^[\w-]{1,80}$/.test(item.boardId)) throw new ScreenError(`${screenLabels[type]}的分榜无效`);
            next.boardId = item.boardId;
        }
        if (item.variant !== undefined) {
            const allowed = screenVariants[type]?.map(([value]) => value) || [''];
            if (!allowed.includes(item.variant)) throw new ScreenError(`${screenLabels[type]}的样式无效`);
            next.variant = item.variant;
        }
        if (item.target !== undefined) {
            if (!['end', 'start', 'custom'].includes(item.target)) throw new ScreenError('倒计时目标无效');
            next.target = item.target;
        }
        if (item.targetTime !== undefined) {
            if (item.targetTime !== null && (typeof item.targetTime !== 'string' || !Number.isFinite(Date.parse(item.targetTime)))) {
                throw new ScreenError('倒计时目标时间无效');
            }
            next.targetTime = item.targetTime === null ? null : new Date(item.targetTime).toISOString();
        }
        if (item.text !== undefined) {
            if (typeof item.text !== 'string' || item.text.length > 2000) throw new ScreenError('公告文字最多 2000 字');
            next.text = item.text;
        }
        if (item.sessionId !== undefined) {
            if (typeof item.sessionId !== 'string' || !/^([a-f\d-]{36})?$/.test(item.sessionId)) throw new ScreenError('滚榜会话无效');
            next.sessionId = item.sessionId;
        }
    }
    if (config.items.countdown.target === 'custom' && !config.items.countdown.targetTime) throw new ScreenError('请填写倒计时的目标时间');
    return config;
}

const exemptStatuses = new Set(['CORRECT', 'COMPILATION_ERROR', 'PRESENTATION_ERROR', 'CANCELED']);

/** The program item handed to PresentationView.render(). */
export function presentationItem(type: ScreenType, item: ScreenItem, data: BoardData) {
    const result: Record<string, unknown> = { type };
    if (item.variant) result.variant = item.variant;
    if (type === 'message') result.text = item.text;
    if (type === 'countdown') {
        const start = data.contest.start_time * 1000;
        const end = data.contest.end_time * 1000;
        result.targetTime = item.target === 'start' ? start : item.target === 'end' ? end : Date.parse(item.targetTime || '') || end;
    }
    return result;
}

/** Public, freeze-masked board → the `data` object of Resolver-Web's presentation state. */
export function screenData(data: BoardData, members: Set<string> | null, context: {
    logoNames: Record<string, string>; locked: boolean;
    /** The board's first-solve rules (awardsFor), so screens highlight exactly what the board does. */
    firstSolve: boolean; unofficialFirstSolve: boolean;
}) {
    const durationMs = (data.contest.end_time - data.contest.start_time) * 1000;
    const freezeMs = Number(data.contest.frozen_time) > 0 ? Number(data.contest.frozen_time) * 1000 : 0;
    const teams = data.teams.filter((team) => !members || members.has(team.team_id)).map((team) => {
        const school = (team.organization || '').trim();
        const logoId = context.logoNames[school.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')];
        return {
            id: team.team_id, name: team.name, displayName: team.name, organizationName: school,
            unrank: team.group.includes('unofficial'),
            logo: logoId && /^[a-f\d]{12}$/.test(logoId) ? `${resolverAssetBase}/logos/${logoId}.webp` : `${resolverAssetBase}/assets/img/icpc-logo.png`,
        };
    });
    const ids = new Set(teams.map((team) => team.id));
    const problems = Array.from({ length: data.contest.problem_quantity }, (_, index) => ({
        id: String(index), label: (data.contest.problem_id as string[])[index],
        color: (data.contest.balloon_color as { background_color: string }[])[index]?.background_color,
    }));
    const submissions = [...new Map(data.submissions.map((record) => [record.submission_id, record])).values()]
        .filter((record) => ids.has(record.team_id) && record.timestamp >= 0 && record.timestamp < durationMs
            && Number.isInteger(record.problem_id) && record.problem_id >= 0 && record.problem_id < problems.length)
        .sort((a, b) => a.timestamp - b.timestamp || a.submission_id.localeCompare(b.submission_id))
        .map((record) => {
            // The board already shows post-freeze results as FROZEN; they stay pending here.
            const pending = record.status === 'PENDING' || record.status === 'FROZEN';
            return {
                id: record.submission_id, teamId: record.team_id, problemId: String(record.problem_id), contestTime: record.timestamp,
                status: record.status === 'CORRECT' ? 'solved' : pending ? 'pending' : 'failed',
                penalty: !pending && !exemptStatuses.has(record.status),
            };
        });
    const c = normalizeContest({
        name: data.contest.contest_name, startTime: new Date(data.contest.start_time * 1000).toISOString(),
        durationMs, freezeDurationMs: freezeMs, scoringMode: 'hydro', penaltyMinutes: 20,
        firstSolveEnabled: context.firstSolve, unofficialFirstSolve: context.unofficialFirstSolve,
        teams, problems, submissions, awards: [],
    });
    const frozen = freezeMs > 0 && context.locked;
    c.awards = [];
    const result = computeCells(c as never, { frozen }) as ReturnType<typeof computeCells> & { results: Record<string, any[]> };
    const results = Object.fromEntries(Object.entries(result.results).map(([id, rows]) => [id, rows.map((row: any) => ({
        status: row.status, attempts: row.attempts, time: row.time, timeSeconds: row.timeSeconds,
        penaltyCount: row.penaltyCount ?? row._penaltyCount, pending: row.pending, firstToSolve: row.firstToSolve,
    }))]));
    // The first-solves list follows the board's eligibility: starred participants only when allowed.
    // It lists the earliest eligible accepts even when the first-solve award itself is switched off.
    const unranked = new Set(teams.filter((team) => team.unrank).map((team) => team.id));
    const firstSolves: unknown[] = [];
    const sourceOrder = new Map((c.submissions as any[]).map((s, i) => [s.id, i]));
    const solved = new Set<string>();
    for (const submission of [...c.submissions as any[]].sort((a, b) => a.contestTime - b.contestTime)) {
        if (unranked.has(submission.teamId) && !context.unofficialFirstSolve) continue;
        if (submission.status === 'solved' && !solved.has(submission.problemId)) {
            solved.add(submission.problemId);
            firstSolves.push({ ...submission, sourceOrder: sourceOrder.get(submission.id) });
        }
    }
    const teamIndex = new Map((c.teams as any[]).map((t, i) => [t.id, i]));
    const problemIndex = new Map((c.problems as any[]).map((p, i) => [p.id, i]));
    const stats: number[] = [];
    let lastEventMs = 0;
    for (const s of c.submissions as any[]) {
        const t = teamIndex.get(s.teamId), p = problemIndex.get(s.problemId);
        if (t === undefined || p === undefined) continue;
        const code = s.status === 'solved' ? 0 : s.status === 'failed' ? (s.penalty === false ? 3 : 1) : 2;
        stats.push(t, p, s.contestTime, code, -1, -1, -1);
        lastEventMs = Math.max(lastEventMs, s.contestTime);
    }
    c.submissions = (c.submissions as any[]).slice(-100);
    return {
        // Unranked (打星) rows carry rank 0; show them with a star as the resolver does, not as "0".
        contest: c, results, standings: result.standings.map((row) => (row.unrank ? { ...row, rank: '*' } : row)), firstSolves, frozen,
        stats: { submissions: stats, lastEventMs },
        clock: { startTime: c.startTime, started: c.startTime, ended: null, multiplier: 1, countdownPauseTime: null },
    };
}
