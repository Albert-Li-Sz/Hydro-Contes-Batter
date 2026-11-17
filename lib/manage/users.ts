/**
 * System administration of accounts and Hydro 5.1 teams: input checks for /manage pages.
 * Pure functions; lib/manage-routes.ts applies them to Hydro's collections.
 */

export class ManageError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

/** Same rules as Hydro's Types.Email and Types.Password. */
const emailPattern = /^[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const passwordPattern = /^.{6,255}$/;
export const MAX_BATCH = 500;

export interface UserEdit {
    displayName?: string;
    mail?: string;
    password?: string;
    school?: string;
    studentId?: string;
}

export interface TeamEdit {
    displayName?: string;
    members?: number[];
    invite?: number[];
    /** Sets every member's login password: Hydro teams have none of their own. */
    memberPassword?: string;
}

const text = (value: unknown, label: string, max: number) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') throw new ManageError(`${label}格式无效`);
    const trimmed = value.trim();
    if (trimmed.length > max) throw new ManageError(`${label}不能超过 ${max} 个字符`);
    return trimmed;
};

export function checkPassword(value: unknown, label = '密码') {
    if (typeof value !== 'string' || !passwordPattern.test(value)) throw new ManageError(`${label}长度需为 6 至 255 个字符`);
    return value;
}

/** Fields an administrator may change; the account name and uid are fixed. Blank password = unchanged. */
export function normalizeUserEdit(input: unknown): UserEdit {
    if (!input || typeof input !== 'object') throw new ManageError('无效的用户资料');
    const raw = input as Record<string, unknown>;
    const edit: UserEdit = {};
    const displayName = text(raw.displayName, '显示名', 64);
    if (displayName !== undefined) edit.displayName = displayName;
    const mail = text(raw.mail, '邮箱', 254);
    if (mail !== undefined) {
        if (!emailPattern.test(mail)) throw new ManageError('邮箱格式无效');
        edit.mail = mail;
    }
    if (typeof raw.password === 'string' && raw.password !== '') edit.password = checkPassword(raw.password);
    const school = text(raw.school, '学校', 128);
    if (school !== undefined) edit.school = school;
    const studentId = text(raw.studentId, '学号', 64);
    if (studentId !== undefined) edit.studentId = studentId;
    if (!Object.keys(edit).length) throw new ManageError('没有需要保存的修改');
    return edit;
}

export function uidList(input: unknown, label = '用户', allowNegative = false): number[] {
    if (!Array.isArray(input)) throw new ManageError(`请选择${label}`);
    const ids = [...new Set(input.map((value) => Number(value)))];
    if (ids.some((id) => !Number.isSafeInteger(id) || (!allowNegative && id <= 0))) throw new ManageError(`${label}编号无效`);
    return ids;
}

export function normalizeTeamEdit(input: unknown, membersLimit = 10): TeamEdit {
    if (!input || typeof input !== 'object') throw new ManageError('无效的队伍资料');
    const raw = input as Record<string, unknown>;
    const edit: TeamEdit = {};
    const displayName = text(raw.displayName, '队名', 64);
    if (displayName !== undefined) {
        if (!displayName) throw new ManageError('队名不能为空');
        edit.displayName = displayName;
    }
    if (raw.members !== undefined) {
        edit.members = uidList(raw.members, '队员');
        if (!edit.members.length) throw new ManageError('队伍至少需要一名队员');
        if (edit.members.length > membersLimit) throw new ManageError(`队员不能超过 ${membersLimit} 人`);
    }
    if (raw.invite !== undefined) {
        edit.invite = uidList(raw.invite, '受邀用户');
        if (edit.members) edit.invite = edit.invite.filter((uid) => !edit.members!.includes(uid));
    }
    if (typeof raw.memberPassword === 'string' && raw.memberPassword !== '') edit.memberPassword = checkPassword(raw.memberPassword, '队员密码');
    if (!Object.keys(edit).length) throw new ManageError('没有需要保存的修改');
    return edit;
}

export interface Account {
    _id: number;
    uname: string;
    priv: number;
}

/** PRIV bits from @hydrooj/common, so this module stays free of the Hydro runtime. */
export const PRIV_EDIT_SYSTEM = 1 << 0;
export const PRIV_JUDGE = 1 << 9;

/** Why an account may not be changed or deleted from these pages, or null. */
export function protectedReason(account: Account, operatorId: number, action: 'edit' | 'delete') {
    if (account._id <= 1) return `${account.uname} 是系统内置账号`;
    if (account.priv === -1) return `${account.uname} 是超级管理员`;
    if (action === 'delete' && account._id === operatorId) return '不能删除当前登录的账号';
    if (action === 'delete' && (account.priv & PRIV_EDIT_SYSTEM)) return `${account.uname} 是系统管理员，请先在“用户权限”中取消其权限`;
    return null;
}

/** Hydro 5.1 teams are virtual users created on the contest team page (`team:<uid>:<random>`). */
export const isTeamDoc = (doc: { members?: unknown }) => Array.isArray(doc.members);

export function searchPattern(query: unknown) {
    if (typeof query !== 'string' || !query.trim()) return null;
    return new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}
