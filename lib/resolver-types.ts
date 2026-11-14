import type { BoardAwards, Medals } from './settings';

export interface ResolverTeam {
    id: string;
    name: string;
    displayName: string;
    organizationName: string;
    unrank: boolean;
    logo: string;
}

export interface ResolverSubmission {
    id: string;
    teamId: string;
    problemId: string;
    contestTime: number;
    status: 'solved' | 'failed' | 'pending';
    penalty: boolean;
}

export interface ResolverContest {
    contestId: string;
    name: string;
    startTime: string;
    durationMs: number;
    freezeDurationMs: number;
    scoringMode: 'hydro';
    penaltyMinutes: number;
    unofficialFirstSolve: boolean;
    firstSolveEnabled: boolean;
    teams: ResolverTeam[];
    problems: { id: string; label: string; color: string }[];
    submissions: ResolverSubmission[];
    awards: unknown[];
}

export interface ResolverBoard {
    id: string;
    name: string;
    teamIds: string[];
    medals: Medals;
    awards: BoardAwards;
}

export interface ResolverConfig {
    mode: 'board' | 'official';
    boardId: string;
    rehearsal: boolean;
    freezeMode: 'contest' | 'custom';
    freezeAtSeconds: number | null;
    goldCount: number;
    silverCount: number;
    bronzeCount: number;
    goldCitation: string;
    silverCitation: string;
    bronzeCitation: string;
    medalSameScore: boolean;
    podiumEnabled: boolean;
    firstSolve: boolean;
    rowsPerScreen: number;
    autoplay: boolean;
    autoplaySpeed: number;
    autoStopAtMedals: boolean;
    startScreen: 'splash' | 'scoreboard';
    showSchool: boolean;
}

export interface ResolverStep {
    type: string;
    screen?: string;
    role?: string;
    [key: string]: unknown;
}

export interface ResolverGame {
    id?: string;
    contest: ResolverContest;
    options: Record<string, unknown>;
    initialState: Record<string, unknown>;
    steps: ResolverStep[];
    meta: {
        pendingCount: number;
        discardedUnjudged: number;
        teamCount: number;
        problemCount: number;
        stepCount: number;
        [key: string]: unknown;
    };
}

export interface ResolverOverview {
    title: string;
    teamCount: number;
    officialCount: number;
    problemCount: number;
    pendingCount: number;
    unjudgedCount: number;
    freezeAtSeconds: number | null;
    durationSeconds: number;
    capturedAt: string;
    ended: boolean;
    rehearsal: boolean;
}

export interface ResolverPayload {
    snapshot: ResolverContest;
    config: ResolverConfig;
    overview: ResolverOverview;
    game: ResolverGame;
}
