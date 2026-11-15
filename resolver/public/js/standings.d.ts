export interface StandingsRecord {
    solved: number;
    time?: number;
    timeSeconds?: number;
    lastSolutionTime?: number;
    sortName?: string;
    displayName?: string;
    teamId: string;
}
export function compareStandings(contest: { scoringMode?: string }, a: StandingsRecord, b: StandingsRecord): number;
export function formatSeconds(seconds: number): string;
