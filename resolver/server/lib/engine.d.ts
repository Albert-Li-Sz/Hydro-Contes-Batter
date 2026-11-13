import type { ResolverContest, ResolverGame } from '../../../lib/resolver-types';
export function buildGame(contest: ResolverContest, options?: Record<string, unknown>, meta?: { id?: string }): ResolverGame;
export function computeCells(contest: ResolverContest, options?: { frozen?: boolean }): {
    standings: { teamId: string; rank: number; solved: number; timeSeconds: number; unrank?: boolean }[];
    results: Record<string, { status: string; pending: number; timeSeconds: number; _penaltyCount: number }[]>;
    pendingCount: number;
};
