/**
 * Batch rejudge from /manage: which records a selection of contest, problems and results covers.
 * Pure; lib/manage-routes.ts runs the query and hands the records to Hydro's judge queue.
 */
import { ManageError } from './users';

/** Hydro STATUS codes (@hydrooj/common). */
export const ACCEPTED = 1;
const CANCELED = 9;

/** Results an administrator can pick, with Hydro's codes. */
export const rejudgeStatuses: [number, string, string][] = [
    [1, 'AC', '通过'],
    [2, 'WA', '答案错误'],
    [3, 'TLE', '超出时间限制'],
    [4, 'MLE', '超出内存限制'],
    [5, 'OLE', '输出超限'],
    [6, 'RE', '运行时错误'],
    [7, 'CE', '编译错误'],
    [8, 'SE', '系统错误'],
    [10, 'UKE', '未知错误'],
    [31, 'PE', '格式错误'],
    [30, 'IGN', '已忽略'],
    [0, 'WAIT', '等待评测（卡住的提交）'],
];

export const MAX_REJUDGE = 100000;

export type RejudgeScope = 'contest' | 'problems' | 'domain';

export interface RejudgeSelection {
    /** A contest's submissions, chosen problems' submissions anywhere in the domain, or the whole domain. */
    scope: RejudgeScope;
    /** Contest id (hex), or null for every submission outside contests and inside them. */
    contest: string | null;
    /** Problem docIds; empty means every problem (of the contest, when one is chosen). */
    pids: number[];
    /** Result codes; empty means every result. */
    statuses: number[];
    /** Accepted submissions keep their result. */
    skipAccepted: boolean;
}

export function normalizeRejudgeSelection(input: unknown): RejudgeSelection {
    if (!input || typeof input !== 'object') throw new ManageError('无效的重测条件');
    const raw = input as Record<string, unknown>;
    const contest = typeof raw.contest === 'string' && raw.contest ? raw.contest : null;
    if (contest && !/^[a-f\d]{24}$/i.test(contest)) throw new ManageError('比赛编号无效');
    const list = (value: unknown, label: string) => {
        if (value === undefined || value === null) return [];
        if (!Array.isArray(value)) throw new ManageError(`${label}格式无效`);
        const items = [...new Set(value.map(Number))];
        if (items.some((item) => !Number.isSafeInteger(item) || item < 0)) throw new ManageError(`${label}无效`);
        return items;
    };
    const pids = list(raw.pids, '题目');
    const known = new Set(rejudgeStatuses.map(([code]) => code));
    const statuses = list(raw.statuses, '结果类型');
    if (statuses.some((status) => !known.has(status))) throw new ManageError('结果类型无效');
    const scope: RejudgeScope = raw.scope === 'domain' || raw.scope === 'problems' || raw.scope === 'contest' ? raw.scope : contest ? 'contest' : 'problems';
    const selection: RejudgeSelection = { scope, contest: scope === 'contest' ? contest : null, pids: scope === 'domain' ? [] : pids, statuses, skipAccepted: raw.skipAccepted !== false };
    // Rejudging a whole domain must be asked for, never the result of an empty form.
    if (scope === 'contest' && !selection.contest) throw new ManageError('请选择比赛');
    if (scope === 'problems' && !selection.pids.length) throw new ManageError('请至少选择一道题目；如需重测全部提交，请选择“整个域”');
    if (selection.skipAccepted && selection.statuses.length === 1 && selection.statuses[0] === ACCEPTED) {
        throw new ManageError('只选择了“通过”，又勾选了“AC 不参与重测”，没有需要重测的提交');
    }
    return selection;
}

/**
 * The record filter, as Hydro's own problem rejudge: no pretests, generated data, hacks or
 * canceled submissions. `special` are Hydro's RECORD_PRETEST and RECORD_GENERATE contest ids.
 */
export function rejudgeFilter(selection: RejudgeSelection, contestId: unknown, special: unknown[]) {
    const filter: Record<string, unknown> = {
        contest: contestId ?? { $nin: special },
        'files.hack': { $exists: false },
    };
    if (selection.pids.length) filter.pid = { $in: selection.pids };
    let statuses = selection.statuses.filter((status) => status !== CANCELED);
    if (selection.skipAccepted) statuses = statuses.filter((status) => status !== ACCEPTED);
    if (statuses.length) filter.status = { $in: statuses };
    else filter.status = { $nin: selection.skipAccepted ? [CANCELED, ACCEPTED] : [CANCELED] };
    return filter;
}

/** Hydro's judge queue loads one problem per call; group the records by problem. */
export function groupByProblem<T extends { pid: number }>(records: T[]) {
    const groups = new Map<number, T[]>();
    for (const record of records) {
        const group = groups.get(record.pid);
        if (group) group.push(record);
        else groups.set(record.pid, [record]);
    }
    return groups;
}

/** Problems matching what is typed into the search box: number, problem id (prefix) or title. */
export function problemSearchFilter(query: string) {
    const text = query.trim().slice(0, 64);
    if (!text) return null;
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const or: Record<string, unknown>[] = [{ pid: { $regex: `^${escaped}`, $options: 'i' } }, { title: { $regex: escaped, $options: 'i' } }];
    if (/^\d+$/.test(text) && Number.isSafeInteger(Number(text))) or.unshift({ docId: Number(text) });
    return { $or: or };
}

/** Hydro's queue receives at most this many records per call, so a domain-wide rejudge stays bounded. */
export const REJUDGE_CHUNK = 2000;

export function chunks<T>(items: T[], size = REJUDGE_CHUNK) {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
}
