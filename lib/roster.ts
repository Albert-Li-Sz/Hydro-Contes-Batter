import type { BoardTeam } from './board';
import { schoolName } from './board';

export interface FilterField { key: string; label: string }
export interface RosterTeam extends BoardTeam {
    username: string;
    fields: Record<string, string[]>;
}

export const builtInFields: FilterField[] = [
    { key: 'school', label: '学校' }, { key: 'participation', label: '参赛资格' },
    { key: 'userGroup', label: 'Hydro 用户组' }, { key: 'name', label: '姓名 / 显示名' },
    { key: 'username', label: '用户名' }, { key: 'id', label: '用户 ID' },
];
export const defaultProfileFields: FilterField[] = [
    { key: 'grade', label: '年级' }, { key: 'class', label: '班级' },
    { key: 'department', label: '学院' }, { key: 'major', label: '专业' },
];

export function profileValues(value: unknown): string[] {
    const values = Array.isArray(value) ? value : [value];
    return [...new Set(values.filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
        .map((item) => String(item).trim()).filter(Boolean))];
}

/** Only explicitly public profile fields can be used; credentials and private objects never enter the roster. */
export function buildRosterTeam(user: {
    _id: number; uname: string; displayName?: string; school?: string; group?: string[];
    getFields?: (visibility: 'public') => string[];
    [key: string]: unknown;
}, unofficial: boolean, profileFields: FilterField[]): RosterTeam {
    const available = new Set(user.getFields?.('public') || []);
    const fields: Record<string, string[]> = { userGroup: profileValues(user.group) };
    for (const field of profileFields) {
        if (/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(field.key) && available.has(field.key)) {
            fields[`profile:${field.key}`] = profileValues(user[field.key]);
        }
    }
    return {
        team_id: `${user._id}`, name: user.displayName || user.uname, username: user.uname,
        organization: schoolName(user.school), group: [unofficial ? 'unofficial' : 'official'], fields,
    };
}

export function rosterFields(teams: RosterTeam[], configured: FilterField[]): FilterField[] {
    return [...builtInFields, ...configured.filter((field) => teams.some((team) => team.fields[`profile:${field.key}`]?.length))
        .map((field) => ({ key: `profile:${field.key}`, label: field.label }))];
}
