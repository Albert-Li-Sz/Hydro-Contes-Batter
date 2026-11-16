/**
 * Who sees which endpoints and properties, and who may change what (the `access` endpoint). Every
 * response and event is projected to exactly the properties listed for the client's role.
 */
import type { Access, Capability, Endpoint, Role } from './types';

const properties: Record<Endpoint, string[]> = {
    contests: ['id', 'name', 'formal_name', 'start_time', 'countdown_pause_time', 'duration', 'scoreboard_freeze_duration', 'scoreboard_thaw_time', 'scoreboard_type', 'main_scoreboard_group_id', 'penalty_time'],
    'judgement-types': ['id', 'name', 'penalty', 'solved', 'simplified_judgement_type_id'],
    languages: ['id', 'name', 'entry_point_required', 'entry_point_name', 'extensions', 'compiler', 'runner'],
    problems: ['id', 'label', 'name', 'ordinal', 'rgb', 'color', 'time_limit', 'memory_limit', 'test_data_count', 'code_limit', 'attachments'],
    groups: ['id', 'name', 'type'],
    organizations: ['id', 'name', 'formal_name', 'logo'],
    teams: ['id', 'name', 'label', 'display_name', 'organization_id', 'group_ids'],
    persons: ['id', 'team_ids', 'name', 'role'],
    accounts: ['id', 'username', 'name', 'type', 'team_id', 'person_id'],
    state: ['started', 'frozen', 'ended', 'thawed', 'finalized', 'end_of_updates'],
    submissions: ['id', 'language_id', 'problem_id', 'team_id', 'account_id', 'time', 'contest_time', 'entry_point', 'files'],
    judgements: ['id', 'submission_id', 'judgement_type_id', 'simplified_judgement_type_id', 'current', 'start_time', 'start_contest_time', 'end_time', 'end_contest_time', 'max_run_time'],
    runs: ['id', 'judgement_id', 'ordinal', 'judgement_type_id', 'run_time'],
    clarifications: ['id', 'from_team_id', 'to_team_ids', 'to_group_ids', 'reply_to_id', 'problem_id', 'text', 'time', 'contest_time'],
    awards: ['id', 'citation', 'team_ids'],
    commentary: ['id', 'time', 'contest_time', 'message', 'tags', 'source_id', 'team_ids', 'problem_ids', 'submission_ids'],
    scoreboard: ['time', 'contest_time', 'state', 'rows'],
    'event-feed': ['type', 'id', 'data', 'token'],
};

/** ID-typed properties a collection can be filtered on (except `id`, as the spec allows). */
export const idProperties: Partial<Record<Endpoint, string[]>> = {
    judgements: ['submission_id', 'judgement_type_id', 'simplified_judgement_type_id'],
    runs: ['judgement_id', 'judgement_type_id'],
    submissions: ['language_id', 'problem_id', 'team_id', 'account_id'],
    teams: ['organization_id'],
    accounts: ['team_id', 'person_id'],
    clarifications: ['from_team_id', 'reply_to_id', 'problem_id'],
    commentary: ['source_id'],
    'judgement-types': ['simplified_judgement_type_id'],
};

export interface AccessContext {
    role: Role;
    /** Schools are visible (the public only when the contest shows them to everyone). */
    identity: boolean;
    /** Whether Hydro uses virtual teams and member accounts. */
    teamContest: boolean;
}

const withoutProps = (list: string[], remove: string[]) => list.filter((item) => !remove.includes(item));

export function endpointProperties(context: AccessContext): Partial<Record<Endpoint, string[]>> {
    const { role, identity } = context;
    const full = role === 'judge' || role === 'admin';
    const result: Partial<Record<Endpoint, string[]>> = {};
    for (const [endpoint, list] of Object.entries(properties) as [Endpoint, string[]][]) {
        if (!full && endpoint === 'accounts') continue;
        if (role === 'public' && endpoint === 'runs') continue;
        if (!identity && endpoint === 'organizations') continue;
        let visible = list;
        if (endpoint === 'teams' && !identity) visible = withoutProps(visible, ['organization_id']);
        // Source files and accounts are the jury's; compile and run commands are internal.
        if (endpoint === 'submissions' && !full) visible = withoutProps(visible, role === 'team' ? ['account_id'] : ['files', 'account_id']);
        if (endpoint === 'languages' && role === 'public') visible = withoutProps(visible, ['compiler', 'runner']);
        result[endpoint] = visible;
    }
    return result;
}

export function capabilities(context: AccessContext): Capability[] {
    switch (context.role) {
        case 'admin': return ['contest_start', 'contest_thaw', 'proxy_submit', 'admin_submit', 'post_clar', 'proxy_clar', 'admin_clar', 'post_comment'];
        case 'judge': return ['post_clar', 'post_comment'];
        case 'team': return ['team_submit', 'post_clar'];
        default: return [];
    }
}

export function accessObject(context: AccessContext): Access {
    const props = endpointProperties(context);
    return {
        capabilities: capabilities(context),
        endpoints: Object.entries(props).map(([type, list]) => ({ type: type === 'contests' ? 'contest' : type as Endpoint, properties: list! })),
    };
}

/** An object as the role may see it: listed properties only, retaining meaningful nulls. */
export function project<T extends object>(object: T, list: string[] | undefined): Partial<T> {
    if (!list) return {};
    const result: Record<string, unknown> = {};
    for (const key of list) {
        const value = (object as Record<string, unknown>)[key];
        if (value === undefined || key === 'files' && Array.isArray(value) && !value.length) continue;
        // These conditional fields must be absent when their discriminator is false.
        if (key === 'entry_point_name' && !(object as any).entry_point_required) continue;
        if (key === 'team_id' && 'username' in object && (object as any).type !== 'team') continue;
        result[key] = value;
    }
    return result as Partial<T>;
}

/** The `account` endpoint (the caller's own account) has the accounts properties. */
export const accountProperties = properties.accounts;
