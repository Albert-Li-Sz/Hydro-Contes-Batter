/**
 * ICPC CCS Contest API, version 2026-01 (https://ccs-specs.icpc.io/2026-01/contest_api):
 * object types and the value formats every endpoint shares.
 */

import { createHash } from 'node:crypto';

export const SPEC_VERSION = '2026-01';
export const SPEC_URL = 'https://ccs-specs.icpc.io/2026-01/contest_api';

/** Endpoint (and event) types in the order the spec lists them. */
export const ENDPOINTS = [
    'contests', 'judgement-types', 'languages', 'problems', 'groups', 'organizations', 'teams', 'persons', 'accounts',
    'state', 'submissions', 'judgements', 'runs', 'clarifications', 'awards', 'commentary', 'scoreboard', 'event-feed',
] as const;
export type Endpoint = typeof ENDPOINTS[number];
/** Collections that are notified in the event feed (contest and state are singletons). */
export const EVENT_TYPES = [
    'contest', 'judgement-types', 'languages', 'problems', 'groups', 'organizations', 'teams', 'persons', 'accounts',
    'state', 'submissions', 'judgements', 'runs', 'clarifications', 'awards', 'commentary',
] as const;
export type EventType = typeof EVENT_TYPES[number];

export const CAPABILITIES = [
    'contest_start', 'contest_thaw', 'team_submit', 'post_clar', 'post_comment', 'proxy_submit', 'proxy_clar', 'admin_submit', 'admin_clar',
] as const;
export type Capability = typeof CAPABILITIES[number];

export type Role = 'public' | 'team' | 'judge' | 'admin';

const pad = (value: number, width = 2) => String(Math.trunc(value)).padStart(width, '0');

/**
 * TIME: ISO 8601 with milliseconds and the server's UTC offset. The spec asks that optional parts
 * are used consistently, so every timestamp carries `.uuu`.
 */
export function abstime(ms: number, offsetMinutes = -new Date(ms).getTimezoneOffset()): string {
    const local = new Date(ms + offsetMinutes * 60_000);
    const sign = offsetMinutes < 0 ? '-' : '+';
    const offset = Math.abs(offsetMinutes);
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.${pad(local.getUTCMilliseconds(), 3)}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

/** RELTIME: `(-)?h:mm:ss.uuu`, hours unbounded. */
export function reltime(ms: number): string {
    const sign = ms < 0 ? '-' : '';
    const total = Math.round(Math.abs(ms));
    const hours = Math.floor(total / 3_600_000);
    return `${sign}${hours}:${pad(Math.floor(total / 60_000) % 60)}:${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`;
}

/** Parses TIME (any offset, optional milliseconds) to epoch ms, or null when malformed. */
export function parseAbstime(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const match = /^([12]\d{3})-([01]\d)-([0-3]\d)T([0-2]\d):([0-5]\d):([0-5]\d)(?:\.(\d{3}))?(Z|([+-])([01]\d)(?::?([0-5]\d))?)$/.exec(value);
    if (!match) return null;
    const [, y, mo, d, h, mi, s, frac, zone, sign, zh, zm] = match;
    const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, frac ? +frac : 0);
    const date = new Date(utc);
    if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d
        || date.getUTCHours() !== +h) return null;
    if (zone === 'Z') return utc;
    const offset = (+zh * 60 + (zm ? +zm : 0)) * (sign === '-' ? -1 : 1);
    return utc - offset * 60_000;
}

/** Parses RELTIME to ms, or null when malformed. */
export function parseReltime(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const match = /^(-)?(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{3}))?$/.exec(value);
    if (!match) return null;
    const [, minus, h, m, s, frac] = match;
    const ms = ((+h * 60 + +m) * 60 + +s) * 1000 + (frac ? +frac : 0);
    return Number.isSafeInteger(ms) ? (minus ? -ms : ms) : null;
}

const ID = /^[A-Za-z0-9_]([A-Za-z0-9_.-]{0,34}[A-Za-z0-9_-])?$/;
export const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

/**
 * Team ids: Hydro's team-contest teams are virtual users with negative ids, and an ID may not start
 * with a dash, so they become `t<n>`; everyone else keeps their user id.
 */
export const teamId = (uid: number) => (uid < 0 ? `t${-uid}` : String(uid));
export function uidOfTeam(id: string): number | null {
    const match = /^(t)?(\d+)$/.exec(id);
    if (!match) return null;
    const value = Number(match[2]);
    return Number.isSafeInteger(value) ? (match[1] ? -value : value) : null;
}

/** A Hydro language key (e.g. `cc.cc17o2`) as an ID: invalid characters become `_`. */
export function stableId(key: string): string {
    if (ID.test(key)) return key;
    const prefix = key.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[-.]+/, '').slice(0, 14).replace(/\.+$/, '') || 'id';
    return `${prefix}-${createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}
export const languageId = stableId;

export interface FileRef {
    href: string;
    filename: string;
    hash?: string | null;
    mime: string;
    width?: number;
    height?: number;
    tags?: string[];
}

export interface Command { command: string; args?: string; version?: string; version_command?: string }

export interface ApiInfo { version: string; version_url: string; provider: { name: string; version: string | null } }
export interface Access { capabilities: Capability[]; endpoints: { type: Endpoint | 'contest'; properties: string[] }[] }

export interface Contest {
    id: string;
    name: string;
    formal_name: string | null;
    start_time: string | null;
    countdown_pause_time: string | null;
    duration: string;
    scoreboard_freeze_duration: string | null;
    scoreboard_thaw_time: string | null;
    scoreboard_type: 'pass-fail';
    main_scoreboard_group_id: string | null;
    penalty_time: string;
}
export interface JudgementType { id: string; name: string; penalty: boolean; solved: boolean; simplified_judgement_type_id: string | null }
export interface Language {
    id: string; name: string; entry_point_required: boolean; entry_point_name: string | null; extensions: string[]; compiler: Command | null; runner: Command | null;
}
export interface Problem {
    id: string; label: string; name: string; ordinal: number; rgb: string | null; color: string | null;
    time_limit: number; memory_limit: number; test_data_count: number; code_limit?: number; attachments: FileRef[] | null;
}
export interface Group { id: string; name: string; type: string | null }
export interface Organization { id: string; name: string; formal_name: string | null; logo: FileRef[] | null }
export interface Team {
    id: string; name: string; label: string; display_name: string | null; organization_id: string | null; group_ids: string[];
}
export interface Person { id: string; team_ids: string[] | null; name: string; role: 'contestant' | 'coach' | 'staff' | 'other' }
export interface Account {
    id: string; username: string; name: string | null; type: 'team' | 'judge' | 'admin' | 'analyst' | 'staff'; team_id: string | null; person_id: string | null;
}
export interface State {
    started: string | null; frozen: string | null; ended: string | null; thawed: string | null; finalized: string | null; end_of_updates: string | null;
}
export interface Submission {
    id: string; language_id: string; problem_id: string; team_id: string | null; account_id: string | null;
    time: string; contest_time: string; entry_point: string | null; files: FileRef[];
}
export interface Judgement {
    id: string; submission_id: string; judgement_type_id: string | null; simplified_judgement_type_id: string | null; current: boolean;
    start_time?: string; start_contest_time?: string; end_time: string | null; end_contest_time: string | null; max_run_time: number | null;
}
export interface Run { id: string; judgement_id: string; ordinal: number; judgement_type_id: string; run_time: number }
export interface Clarification {
    id: string; from_team_id: string | null; to_team_ids: string[] | null; to_group_ids: string[] | null; reply_to_id: string | null;
    problem_id: string | null; text: string; time: string; contest_time: string;
}
export interface Award { id: string; citation: string; team_ids: string[] | null }
export interface Commentary {
    id: string; time: string; contest_time: string; message: string; tags: string[]; source_id: string | null;
    team_ids: string[] | null; problem_ids: string[] | null; submission_ids: string[] | null;
}
export interface ScoreboardRow {
    rank: number; team_id: string;
    score: { num_solved: number; total_time: string; time: string | null };
    problems: { problem_id: string; num_judged: number; num_pending: number; solved: boolean; time?: string }[];
}
export interface Scoreboard { time: string; contest_time: string; state: State; rows: ScoreboardRow[] }

export interface Notification { type: EventType; id: string | null; data: unknown; token?: string }

/** A request error, answered as `{"code","message"}` with the same HTTP status. */
export class CcsError extends Error {
    constructor(public code: number, message: string) { super(message); }
}
