/**
 * ICPC scoreboard as computed by ICPC Live v3 (cds/core scoreboard/*.kt, MIT), ported to TypeScript.
 * Penalty uses Hydro's ACM rule: whole seconds summed, 20 minutes per wrong attempt.
 */
import type {
    Award, ContestInfo, ICPCProblemResult, OptimismLevel, RunInfo, ScoreboardDiff, ScoreboardRow, SolutionsStatistic, TimeLineRunInfo,
} from './types';

const isJudged = (run: RunInfo) => run.result.type === 'ICPC';
const isAccepted = (run: RunInfo) => run.result.type === 'ICPC' && run.result.verdict.isAccepted;
const isAddingPenalty = (run: RunInfo) => run.result.type === 'ICPC' && run.result.verdict.isAddingPenalty;

const rules: Record<OptimismLevel, {
    accepted: (run: RunInfo, index: number, count: number) => boolean;
    pending: (run: RunInfo, index: number, count: number) => boolean;
    penalty: (run: RunInfo, index: number, count: number) => boolean;
}> = {
    normal: {
        accepted: (run) => isAccepted(run),
        pending: (run) => !isJudged(run),
        penalty: (run) => isJudged(run) && isAddingPenalty(run),
    },
    pessimistic: {
        accepted: (run) => isAccepted(run),
        pending: () => false,
        penalty: (run) => !isJudged(run) || isAddingPenalty(run),
    },
    optimistic: {
        accepted: (run, index, count) => isAccepted(run) || (!isJudged(run) && index === count - 1),
        pending: () => false,
        penalty: (run, index, count) => isAddingPenalty(run) || (!isJudged(run) && index !== count - 1),
    },
};

/** `runs` of one team, in submission order. */
export function scoreboardRow(info: ContestInfo, runs: RunInfo[], level: OptimismLevel): ScoreboardRow {
    const rule = rules[level];
    const byProblem = new Map<string, RunInfo[]>();
    for (const run of runs) {
        if (run.isHidden) continue;
        byProblem.set(run.problemId, [...(byProblem.get(run.problemId) || []), run]);
    }
    let solved = 0;
    let penalty = 0;
    let lastAccepted = 0;
    const problemResults = info.problems.filter((problem) => !problem.isHidden).map((problem): ICPCProblemResult => {
        const problemRuns = byProblem.get(problem.id) || [];
        const okIndex = problemRuns.findIndex((run, index) => rule.accepted(run, index, problemRuns.length));
        const before = okIndex === -1 ? problemRuns : problemRuns.slice(0, okIndex);
        const okRun = okIndex === -1 ? null : problemRuns[okIndex];
        const wrongAttempts = before.filter((run, index) => rule.penalty(run, index, problemRuns.length)).length;
        const result: ICPCProblemResult = {
            type: 'ICPC',
            wrongAttempts,
            pendingAttempts: before.filter((run, index) => rule.pending(run, index, problemRuns.length)).length,
            isSolved: !!okRun,
            isFirstToSolve: okRun?.result.type === 'ICPC' && okRun.result.isFirstToSolveRun,
            lastSubmitTimeMs: (okRun || before.at(-1))?.time ?? null,
        };
        if (okRun) {
            solved += problem.weight;
            penalty += Math.floor(okRun.time / 1000) + wrongAttempts * info.penaltyPerWrongAttemptSeconds;
            lastAccepted = Math.max(lastAccepted, okRun.time);
        }
        return result;
    });
    return { totalScore: solved, penalty, lastAcceptedMs: lastAccepted, problemResults };
}

const compareRows = (a: ScoreboardRow, b: ScoreboardRow) =>
    b.totalScore - a.totalScore || a.penalty - b.penalty || a.lastAcceptedMs - b.lastAcceptedMs;

export interface Ranking {
    order: string[];
    ranks: number[];
    awards: Award[];
}

/** AbstractScoreboardCalculator.getRanking without the organization limits (Hydro has none). */
export function ranking(info: ContestInfo, rows: Map<string, ScoreboardRow>): Ranking {
    const teams = new Map(info.teams.map((team) => [team.id, team]));
    const entries = info.teams.filter((team) => !team.isHidden)
        .map((team) => [team.id, rows.get(team.id)!] as const)
        .filter(([, row]) => info.showTeamsWithoutSubmissions || row.problemResults.some((result) => result.lastSubmitTimeMs !== null))
        .sort((a, b) => compareRows(a[1], b[1]) || teams.get(a[0])!.name.localeCompare(teams.get(b[0])!.name) || a[0].localeCompare(b[0]));
    const order = entries.map(([id]) => id);
    const ranks = order.map(() => 0);
    let nextRank = 1;
    let right = 0;
    while (right < entries.length) {
        const left = right;
        while (right < entries.length && compareRows(entries[left][1], entries[right][1]) === 0) right++;
        const rank = nextRank;
        for (let i = left; i < right; i++) {
            if (teams.get(order[i])!.isOutOfContest) continue;
            ranks[i] = rank;
            nextRank++;
        }
    }
    const awards: Award[] = [];
    for (const chain of info.awardsSettings) {
        if (!chain.awards.length) continue;
        const included = new Set(chain.groups || []);
        const excluded = new Set(chain.excludedGroups || []);
        const candidates = order.map((_, index) => index).filter((index) => {
            const team = teams.get(order[index])!;
            if (team.isOutOfContest) return false;
            if (included.size && !team.groups.some((group) => included.has(group))) return false;
            return !team.groups.some((group) => excluded.has(group));
        });
        const chainAwarded = new Set<number>();
        for (const award of chain.awards) {
            const awarded = new Set<number>();
            const processChunk = (chunk: number[]) => {
                if (award.tiebreakMode !== 'ALL') {
                    if (chainAwarded.size + chunk.length > (award.chainLimit ?? Infinity)) return false;
                    if (awarded.size + chunk.length > (award.limit ?? Infinity)) return false;
                }
                for (const index of chunk) {
                    awarded.add(index);
                    chainAwarded.add(index);
                }
                if (award.tiebreakMode === 'ALL') {
                    if (chainAwarded.size >= (award.chainLimit ?? Infinity)) return false;
                    if (awarded.size >= (award.limit ?? Infinity)) return false;
                }
                return true;
            };
            if (award.manualTeamIds?.length) {
                processChunk(order.map((_, index) => index).filter((index) => award.manualTeamIds!.includes(order[index]) && !chainAwarded.has(index)));
            }
            let chunkRank = -1;
            let chunk: number[] = [];
            let stopped = false;
            for (const index of candidates) {
                if (chainAwarded.has(index)) continue;
                if (award.maxRank != null && ranks[index] > award.maxRank) break;
                if (award.minScore != null && rows.get(order[index])!.totalScore < award.minScore) break;
                if (chunkRank !== ranks[index]) {
                    if (!processChunk(chunk)) {
                        chunk = [];
                        stopped = true;
                        break;
                    }
                    chunkRank = ranks[index];
                    chunk = [];
                }
                chunk.push(index);
            }
            if (!stopped) processChunk(chunk);
            awards.push({ id: award.id, citation: award.citation, teams: [...awarded].map((index) => order[index]) });
        }
    }
    return { order, ranks, awards };
}

export interface ScoreboardState {
    rows: Map<string, ScoreboardRow>;
    ranking: Ranking;
}

export function runsByTeam(runs: RunInfo[]) {
    const result = new Map<string, RunInfo[]>();
    for (const run of runs) result.set(run.teamId, [...(result.get(run.teamId) || []), run]);
    return result;
}

export function computeScoreboard(info: ContestInfo, byTeam: Map<string, RunInfo[]>, level: OptimismLevel): ScoreboardState {
    const rows = new Map(info.teams.map((team) => [team.id, scoreboardRow(info, byTeam.get(team.id) || [], level)]));
    return { rows, ranking: ranking(info, rows) };
}

/** A full snapshot, or only the rows that differ from `previous`. */
export function scoreboardDiff(state: ScoreboardState, previous?: ScoreboardState): ScoreboardDiff {
    const rows: Record<string, ScoreboardRow> = {};
    for (const id of state.ranking.order) {
        const row = state.rows.get(id)!;
        if (!previous || JSON.stringify(previous.rows.get(id)) !== JSON.stringify(row)) rows[id] = row;
    }
    return { rows, ...state.ranking };
}

export function statistics(info: ContestInfo, state: ScoreboardState): SolutionsStatistic {
    const problems = info.problems.filter((problem) => !problem.isHidden);
    return {
        type: 'ICPC',
        teamsCount: state.ranking.order.length,
        stats: problems.map((_, index) => {
            let success = 0;
            let wrong = 0;
            let pending = 0;
            for (const id of state.ranking.order) {
                const result = state.rows.get(id)?.problemResults[index];
                if (!result) continue;
                if (result.isSolved) success++;
                else if (result.pendingAttempts > 0) pending++;
                else if (result.wrongAttempts > 0) wrong++;
            }
            return { success, wrong, pending };
        }),
    };
}

/** TimelineService.toTimeLine: each problem until (and including) its first accepted run. */
export function timeline(runs: RunInfo[]): TimeLineRunInfo[] {
    const accepted = new Set<string>();
    const result: TimeLineRunInfo[] = [];
    for (const run of runs) {
        if (run.result.type === 'IN_PROGRESS') {
            result.push({ type: 'IN_PROGRESS', time: run.time, problemId: run.problemId });
            continue;
        }
        if (accepted.has(run.problemId)) continue;
        if (run.result.verdict.isAccepted) accepted.add(run.problemId);
        result.push({ type: 'ICPC', time: run.time, problemId: run.problemId, isAccepted: run.result.verdict.isAccepted, shortName: run.result.verdict.shortName });
    }
    return result;
}
