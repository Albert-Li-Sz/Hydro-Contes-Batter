import type { RosterTeam } from '../lib/roster';
export interface MemberRule { field: string; operator: string; values?: string[] }
export function normalize(value: unknown): string;
export function fieldValues(team: RosterTeam, field: string): string[];
export function matchesRule(team: RosterTeam, rule: MemberRule): boolean;
export function filterMembers<T extends RosterTeam>(teams: T[], filter?: { query?: string; rules?: MemberRule[]; mode?: string }): T[];
export function bulkSelection(selected: Set<string>, matches: RosterTeam[], operation: string): Set<string>;
