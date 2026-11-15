/**
 * ICPC scoreboard rows as computed by ICPC Live v3 (cds/core scoreboard/*.kt, MIT), ported to TypeScript.
 * Penalty, ranks and medals follow the rest of this plugin: Hydro's ACM rule, whole seconds
 * summed, 20 minutes per wrong attempt.
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

/**
 * The plugin's one ranking rule (resolver/public/js/standings.js compareStandings in Hydro mode,
 * also used by the board's award policy): more problems, then less penalty in seconds; teams
 * equal in both share a rank. Within a tie, names in the same collation, then team id.
 */
const names = new Intl.Collator('en');
const sameScore = (a: ScoreboardRow, b: ScoreboardRow) => a.totalScore === b.totalScore && a.penalty === b.penalty;
export function compareTeams(a: { id: string; name: string; row: ScoreboardRow }, b: { id: string; name: string; row: ScoreboardRow }) {
    return b.row.totalScore - a.row.totalScore || a.row.penalty - b.row.penalty
        || names.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface Ranking {
    order: string[];
    ranks: number[];
    awards: Award[];
}

/**
 * Ranks and medals as on the board (lib/award-policy.mjs): out-of-contest teams are listed but
 * unranked and never medalled; medals go to official teams that solved something, by rank when
 * tied teams share a medal, otherwise by position.
 */
export function ranking(info: ContestInfo, rows: Map<string, ScoreboardRow>): Ranking {
    const entries = info.teams.filter((team) => !team.isHidden)
        .map((team) => ({ id: team.id, name: team.name, row: rows.get(team.id)!, out: team.isOutOfContest, groups: team.groups }))
        .filter(({ row }) => info.showTeamsWithoutSubmissions || row.problemResults.some((result) => result.lastSubmitTimeMs !== null))
        .sort(compareTeams);
    const order = entries.map(({ id }) => id);
    const ranks = order.map(() => 0);
    const chain = info.awardsSettings[0];
    const excluded = new Set(chain?.excludedGroups || []);
    const medals = (chain?.awards || []).map((award) => ({ ...award, teams: [] as string[] }));
    let position = 0;
    let previous: (typeof entries)[number] | null = null;
    let previousRank = 0;
    entries.forEach((entry, index) => {
        if (entry.out) return;
        position++;
        const rank = previous && sameScore(previous.row, entry.row) ? previousRank : position;
        ranks[index] = rank;
        previous = entry;
        previousRank = rank;
        if (entry.row.totalScore <= 0 || entry.groups.some((group) => excluded.has(group))) return;
        for (const medal of medals) {
            const awardRank = medal.tiebreakMode === 'ALL' ? rank : position;
            if (awardRank <= (medal.chainLimit ?? 0)) {
                medal.teams.push(entry.id);
                break;
            }
        }
    });
    return { order, ranks, awards: medals.map(({ id, citation, teams }) => ({ id, citation, teams })) };
}

/** A team's rank among `rows` by the same rule; 0 when it is not ranked. */
export function rankOf(info: ContestInfo, rows: Map<string, ScoreboardRow>, teamId: string) {
    const team = info.teams.find((item) => item.id === teamId);
    const row = rows.get(teamId);
    if (!team || !row || team.isOutOfContest || team.isHidden) return 0;
    let better = 0;
    for (const other of info.teams) {
        if (other.isOutOfContest || other.isHidden || other.id === teamId) continue;
        const candidate = rows.get(other.id);
        if (candidate && (candidate.totalScore > row.totalScore || (candidate.totalScore === row.totalScore && candidate.penalty < row.penalty))) better++;
    }
    return better + 1;
}

/**
 * Each target run's team rank and solved count right after that run, replaying `runs` (in
 * submission order) on the normal scoreboard. Commentary uses this, so history regenerated
 * after a restart states the rank of the time, not today's.
 */
export function standingsAtRuns(info: ContestInfo, runs: RunInfo[], targets: Set<string>) {
    const result = new Map<string, { rank: number; solved: number }>();
    if (!targets.size) return result;
    const rows = new Map(info.teams.map((team) => [team.id, scoreboardRow(info, [], 'normal')]));
    const byTeam = new Map<string, RunInfo[]>();
    let remaining = targets.size;
    for (const run of runs) {
        if (run.isHidden) continue;
        const list = [...(byTeam.get(run.teamId) || []), run];
        byTeam.set(run.teamId, list);
        rows.set(run.teamId, scoreboardRow(info, list, 'normal'));
        if (!targets.has(run.id)) continue;
        result.set(run.id, {
            rank: rankOf(info, rows, run.teamId),
            solved: rows.get(run.teamId)!.problemResults.filter((item) => item.isSolved).length,
        });
        if (!--remaining) break;
    }
    return result;
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
