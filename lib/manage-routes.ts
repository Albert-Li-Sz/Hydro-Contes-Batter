import fs from 'node:fs';
import path from 'node:path';
import {
    ContestModel, Context, DomainModel, Handler, ObjectId, param, PRIV, ProblemModel, RecordModel, SettingModel, SystemModel,
    TaskModel, TokenModel, Types, UserModel,
} from 'hydrooj';
import { resolverCodeBase } from './resolver-data';
import { toScriptJson } from './settings';
import {
    checkJudgeName, type DaemonConfig, defaultJudgeRule, dispatchFor, emptyDaemonConfig, judgeConfig, judgePassword, type JudgeRule,
    judgeScopes, normalizeJudgeRule, readDaemonConfig,
} from './manage/judges';
import { groupByProblem, MAX_REJUDGE, normalizeRejudgeSelection, rejudgeFilter, rejudgeStatuses } from './manage/rejudge';
import {
    type Account, isTeamDoc, MAX_BATCH, ManageError, normalizeTeamEdit, normalizeUserEdit, PRIV_JUDGE, protectedReason,
    searchPattern, uidList,
} from './manage/users';

interface JudgeRuleDoc extends JudgeRule {
    _id: number;
    updatedAt: Date;
    updatedBy: number;
}

const PAGE_SIZE = 50;
const TYPE_CONTEST = 30;
/** Live judges published by the monitor (lib/monitor-routes.ts) within this window are connected. */
const LIVE_MS = 20_000;
const RULES_REFRESH_MS = 15_000;

interface JudgeConnection {
    category?: string;
    constructor: { name: string };
    user?: { _id: number; uname?: string };
    request?: { ip?: string };
    query?: Record<string, unknown>;
    concurrency?: number;
    consumer?: { setQuery: (query: any) => void; setConcurrency: (value: number) => void } | null;
    message?: (msg: any) => unknown;
    close?: (code: number, reason: string) => void;
}

/**
 * System administration pages in Hydro's control panel (/manage): accounts and Hydro 5.1 teams,
 * judge machines with their dispatch rules, and batch rejudges. System administrators only.
 */
export function applyManage(ctx: Context) {
    const codeBase = resolverCodeBase(JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version);
    // Hydro's own collections without typings for these fields; queries mirror Hydro's models.
    const raw = (name: string): any => ctx.db.collection(name as never);
    const rulesColl = raw('xcpcio.manage.judges');
    const broadcast = (event: string, ...args: unknown[]) => (ctx as unknown as { broadcast: (e: string, ...a: unknown[]) => void }).broadcast(event, ...args);
    const on = ctx.on.bind(ctx) as unknown as (name: string, listener: (...args: any[]) => unknown) => () => void;
    const forgetUser = (udoc: unknown) => (UserModel as unknown as { _deleteUserCache?: (doc: unknown) => void })._deleteUserCache?.(udoc);

    abstract class ManageHandler extends Handler {
        async prepare() {
            this.response.addHeader('Cache-Control', 'no-store');
            this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        }

        payload(rawPayload: string) {
            if (rawPayload.length > 200000) throw new ManageError('请求内容过大');
            try { return JSON.parse(rawPayload); } catch { throw new ManageError('请求格式无效'); }
        }

        /** Destructive operations ask for the operator's own Hydro password. */
        async verifyAdmin(password: unknown) {
            await this.limitRate('xcpcio_manage_verify', 300, 20);
            if (typeof password !== 'string' || !password) throw new ManageError('请输入管理员密码', 403);
            try {
                await (this.user as unknown as { checkPassword: (value: string) => Promise<void> }).checkPassword(password);
            } catch {
                throw new ManageError('管理员密码错误', 403);
            }
        }

        async onerror(error: Parameters<Handler['onerror']>[0] | ManageError) {
            if (error instanceof ManageError) {
                this.response.status = error.status;
                this.response.body = { error: error.message };
                return;
            }
            return super.onerror(error);
        }
    }

    /** Removes an account: profile, domain memberships, sessions, groups and team memberships. */
    async function deleteAccount(udoc: Account & { mail?: string }, purge: boolean) {
        const uid = udoc._id;
        await Promise.all([
            UserModel.coll.deleteOne({ _id: uid }),
            raw('domain.user').deleteMany({ uid }),
            TokenModel.delByUid(uid),
            raw('user.group').updateMany({ uids: uid }, { $pull: { uids: uid } }),
            raw('vuser').updateMany({ $or: [{ members: uid }, { invite: uid }] }, { $pull: { members: uid, invite: uid } }),
            rulesColl.deleteOne({ _id: uid }),
        ]);
        if (purge) await purgeParticipation(uid, true);
        forgetUser(udoc);
        broadcast('user/delcache', true);
    }

    /** Contest registrations (and with `records`, submissions) of a user or team. */
    async function purgeParticipation(uid: number, records: boolean) {
        const statuses = raw('document.status');
        const attended = await statuses.find({ docType: TYPE_CONTEST, uid }).project({ domainId: 1, docId: 1, attend: 1 }).toArray();
        for (const status of attended) {
            if (status.attend) await raw('document').updateOne({ domainId: status.domainId, docType: TYPE_CONTEST, docId: status.docId }, { $inc: { attend: -1 } });
        }
        await statuses.deleteMany({ uid });
        if (records) await RecordModel.coll.deleteMany({ uid });
    }

    async function displayNames(domainId: string, uids: number[]) {
        const docs = uids.length ? await raw('domain.user').find({ domainId, uid: { $in: uids } }).project({ uid: 1, displayName: 1 }).toArray() : [];
        return new Map<number, string>(docs.map((doc: { uid: number; displayName?: string }) => [doc.uid, doc.displayName || '']));
    }

    /** Accounts named by uid or login name, as typed into the team form. */
    async function resolveAccounts(names: unknown, label: string) {
        if (!Array.isArray(names)) return undefined;
        const uids: number[] = [];
        for (const name of names.map((value) => String(value).trim()).filter(Boolean)) {
            const udoc = /^\d+$/.test(name)
                ? await UserModel.coll.findOne({ _id: Number(name) })
                : await UserModel.coll.findOne({ unameLower: name.toLowerCase() });
            if (!udoc || udoc._id <= 1) throw new ManageError(`${label} ${name} 不存在`);
            uids.push(udoc._id);
        }
        return uids;
    }

    // ---------------------------------------------------------------- Users and teams

    class UsersHandler extends ManageHandler {
        async get() {
            this.response.template = 'xcpcio_manage_users.html';
            this.response.body = {
                codeBase,
                runtimeJson: toScriptJson({ base: this.request.path, dataUrl: `${this.request.path}/data`, domainId: this.domain._id }),
            };
        }

        @param('payload', Types.String)
        async postUpdateUser(domainId: string, rawPayload: string) {
            const { uid, edit: input } = this.payload(rawPayload);
            const udoc = await UserModel.coll.findOne({ _id: Number(uid) });
            if (!udoc) throw new ManageError('用户不存在', 404);
            const reason = protectedReason(udoc, this.user._id, 'edit');
            if (reason) throw new ManageError(reason, 403);
            const edit = normalizeUserEdit(input);
            if (edit.mail && edit.mail.toLowerCase() !== String(udoc.mail).toLowerCase()) {
                const other = await UserModel.getByEmail('system', edit.mail);
                if (other && other._id !== udoc._id) throw new ManageError(`邮箱 ${edit.mail} 已被其他账号使用`);
                await UserModel.setEmail(udoc._id, edit.mail);
            }
            if (edit.password) {
                await UserModel.setPassword(udoc._id, edit.password);
                // Signed-in sessions end with the old password.
                await TokenModel.delByUid(udoc._id);
            }
            const profile: Record<string, string> = {};
            if (edit.school !== undefined) profile.school = edit.school;
            if (edit.studentId !== undefined) profile.studentId = edit.studentId;
            if (Object.keys(profile).length) await UserModel.setById(udoc._id, profile);
            // Display names live per domain, as Hydro's own user import sets them.
            if (edit.displayName !== undefined) await DomainModel.setUserInDomain(domainId, udoc._id, { displayName: edit.displayName });
            forgetUser(udoc);
            this.response.body = { ok: true };
        }

        @param('payload', Types.String)
        async postDeleteUsers(_domainId: string, rawPayload: string) {
            const { uids: input, password, purge } = this.payload(rawPayload);
            const uids = uidList(input);
            if (!uids.length) throw new ManageError('请选择要删除的用户');
            if (uids.length > MAX_BATCH) throw new ManageError(`一次最多删除 ${MAX_BATCH} 个用户`);
            await this.verifyAdmin(password);
            const udocs = await UserModel.coll.find({ _id: { $in: uids } }).toArray();
            const deleted: number[] = [];
            const skipped: string[] = [];
            for (const udoc of udocs) {
                const reason = protectedReason(udoc, this.user._id, 'delete');
                if (reason) { skipped.push(reason); continue; }
                await deleteAccount(udoc, !!purge);
                deleted.push(udoc._id);
            }
            if (deleted.length) broadcast('xcpcio/judge-rules');
            this.response.body = { deleted, skipped, missing: uids.length - udocs.length };
        }

        @param('payload', Types.String)
        async postUpdateTeam(_domainId: string, rawPayload: string) {
            const { uid, edit: input, sync } = this.payload(rawPayload);
            const vuid = Number(uid);
            const team = await raw('vuser').findOne({ _id: vuid });
            if (!team || !isTeamDoc(team)) throw new ManageError('队伍不存在', 404);
            const limit = Number(SystemModel.get('limit.team_members')) || 10;
            const edit = normalizeTeamEdit({
                ...input,
                members: await resolveAccounts(input?.members, '队员'),
                invite: await resolveAccounts(input?.invite, '受邀用户'),
            }, Math.max(limit, 1));
            const $set: Record<string, unknown> = {};
            if (edit.displayName !== undefined) $set.displayName = edit.displayName;
            if (edit.members) $set.members = edit.members;
            if (edit.invite) $set.invite = edit.invite;
            if (Object.keys($set).length) {
                await raw('vuser').updateOne({ _id: vuid }, { $set });
                forgetUser(team);
            }
            let synced = 0;
            const statusSet: Record<string, unknown> = {};
            if (edit.displayName !== undefined) statusSet.displayName = edit.displayName;
            if (edit.members) statusSet.members = edit.members;
            // Hydro copies the name and members into each contest the team attends.
            if (sync !== false && Object.keys(statusSet).length) {
                synced = (await raw('document.status').updateMany({ docType: TYPE_CONTEST, uid: vuid }, { $set: statusSet })).modifiedCount;
            }
            let passwords = 0;
            if (edit.memberPassword) {
                const members = await UserModel.coll.find({ _id: { $in: edit.members || team.members } }).toArray();
                for (const member of members) {
                    if (protectedReason(member, this.user._id, 'edit')) continue;
                    await UserModel.setPassword(member._id, edit.memberPassword);
                    await TokenModel.delByUid(member._id);
                    passwords++;
                }
            }
            this.response.body = { ok: true, synced, passwords };
        }

        @param('payload', Types.String)
        async postDeleteTeams(_domainId: string, rawPayload: string) {
            const { uids: input, password, withStatus } = this.payload(rawPayload);
            const uids = uidList(input, '队伍', true).filter((uid) => uid < 0);
            if (!uids.length) throw new ManageError('请选择要删除的队伍');
            if (uids.length > MAX_BATCH) throw new ManageError(`一次最多删除 ${MAX_BATCH} 支队伍`);
            await this.verifyAdmin(password);
            const teams = await raw('vuser').find({ _id: { $in: uids } }).toArray();
            const deleted: number[] = [];
            for (const team of teams.filter(isTeamDoc)) {
                await raw('vuser').deleteOne({ _id: team._id });
                if (withStatus) await purgeParticipation(team._id, false);
                forgetUser(team);
                deleted.push(team._id);
            }
            this.response.body = { deleted, missing: uids.length - deleted.length };
        }
    }

    class UsersDataHandler extends ManageHandler {
        notUsage = true;

        @param('tab', Types.String, true)
        @param('q', Types.String, true)
        @param('page', Types.PositiveInt, true)
        async get(domainId: string, tab = 'users', q = '', page = 1) {
            this.response.body = tab === 'teams' ? await this.teams(domainId, q, page) : await this.users(domainId, q, page);
        }

        async users(domainId: string, q: string, page: number) {
            const pattern = searchPattern(q);
            const conditions: object[] = [{ _id: { $gte: 2 } }];
            if (pattern) {
                const named = await raw('domain.user').find({ domainId, displayName: pattern }).project({ uid: 1 }).limit(500).toArray();
                const or: object[] = [{ uname: pattern }, { mail: pattern }, { school: pattern }, { studentId: pattern },
                    { _id: { $in: named.map((doc: { uid: number }) => doc.uid) } }];
                if (/^\d+$/.test(q.trim())) or.push({ _id: Number(q.trim()) });
                conditions.push({ $or: or });
            }
            const filter = { $and: conditions };
            const [total, udocs] = await Promise.all([
                UserModel.coll.countDocuments(filter),
                UserModel.coll.find(filter).sort({ _id: 1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
                    .project({ _id: 1, uname: 1, mail: 1, school: 1, studentId: 1, priv: 1, regat: 1, loginat: 1 }).toArray(),
            ]);
            const names = await displayNames(domainId, udocs.map((udoc) => udoc._id));
            return {
                total, page, pageSize: PAGE_SIZE,
                users: udocs.map((udoc) => ({
                    _id: udoc._id, uname: udoc.uname, mail: udoc.mail, school: udoc.school || '', studentId: udoc.studentId || '',
                    displayName: names.get(udoc._id) || '', regat: udoc.regat, loginat: udoc.loginat,
                    judge: udoc.priv !== -1 && !!(udoc.priv & PRIV_JUDGE),
                    locked: protectedReason(udoc as Account, this.user._id, 'edit'),
                    undeletable: protectedReason(udoc as Account, this.user._id, 'delete'),
                })),
            };
        }

        async teams(domainId: string, q: string, page: number) {
            const pattern = searchPattern(q);
            const filter: Record<string, unknown> = { members: { $exists: true } };
            if (pattern) filter.$or = [{ displayName: pattern }, { uname: pattern }];
            const vusers = raw('vuser');
            const [total, teams] = await Promise.all([
                vusers.countDocuments(filter),
                vusers.find(filter).sort({ _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
            ]);
            const people = [...new Set<number>(teams.flatMap((team: { members?: number[]; invite?: number[] }) => [...team.members || [], ...team.invite || []]))];
            const [udocs, names, counts] = await Promise.all([
                people.length ? UserModel.coll.find({ _id: { $in: people } }).project<{ _id: number; uname: string }>({ _id: 1, uname: 1 }).toArray() : [],
                displayNames(domainId, people),
                teams.length ? raw('document.status').aggregate([
                    { $match: { docType: TYPE_CONTEST, uid: { $in: teams.map((team: { _id: number }) => team._id) } } },
                    { $group: { _id: '$uid', n: { $sum: 1 } } },
                ]).toArray() : [],
            ]);
            const unames = new Map<number, string>(udocs.map((udoc) => [udoc._id, udoc.uname]));
            const person = (uid: number) => ({ _id: uid, uname: unames.get(uid) ?? null, displayName: names.get(uid) || '' });
            const contests = new Map<number, number>(counts.map((row: { _id: number; n: number }) => [row._id, row.n]));
            return {
                total, page, pageSize: PAGE_SIZE,
                teams: teams.map((team: { _id: number; uname: string; displayName?: string; members?: number[]; invite?: number[]; regat?: Date }) => ({
                    _id: team._id, uname: team.uname, displayName: team.displayName || '', regat: team.regat,
                    members: (team.members || []).map(person), invite: (team.invite || []).map(person), contests: contests.get(team._id) || 0,
                })),
            };
        }
    }

    // ---------------------------------------------------------------- Judge machines

    const rules = new Map<number, JudgeRule>();
    const daemons = new Map<JudgeConnection, DaemonConfig>();

    function enforce(handler: JudgeConnection) {
        const uid = handler.user?._id;
        const daemon = daemons.get(handler);
        // Judges nobody has configured here keep Hydro's own query untouched.
        if (uid === undefined || !daemon || !rules.has(uid)) return;
        const { query, concurrency } = dispatchFor(rules.get(uid)!, daemon);
        handler.query = query;
        // Hydro starts the consumer with handler.concurrency; 0 keeps a paused judge idle.
        handler.concurrency = concurrency;
        handler.consumer?.setQuery(query);
        handler.consumer?.setConcurrency(concurrency);
    }

    async function loadRules() {
        const docs: JudgeRuleDoc[] = await rulesColl.find({}).toArray();
        rules.clear();
        for (const doc of docs) rules.set(doc._id, normalizeJudgeRule(doc));
        const alive = new Set(docs.map((doc) => doc._id));
        for (const handler of daemons.keys()) {
            const uid = handler.user?._id;
            // A judge account deleted elsewhere: end its connection.
            if (uid !== undefined && !alive.has(uid) && !await UserModel.coll.findOne({ _id: uid }, { projection: { _id: 1 } })) {
                handler.close?.(4000, 'Judge account deleted');
                continue;
            }
            enforce(handler);
        }
    }
    const reload = () => { loadRules().catch(() => null); };
    reload();
    on('xcpcio/judge-rules', reload);
    const refresher = setInterval(reload, RULES_REFRESH_MS);
    refresher.unref?.();
    ctx.effect(() => () => clearInterval(refresher));

    on('connection/active', (handler: JudgeConnection) => {
        if (handler?.category !== '#judge' && handler?.constructor?.name !== 'JudgeConnectionHandler') return;
        if (typeof handler.message !== 'function') return;
        daemons.set(handler, emptyDaemonConfig());
        const message = handler.message.bind(handler);
        handler.message = async (msg: Record<string, unknown>) => {
            if (msg?.key === 'config') daemons.set(handler, readDaemonConfig(daemons.get(handler) ?? emptyDaemonConfig(), msg));
            // Before `start`, so Hydro creates the consumer with the administrator's limits.
            if (msg?.key === 'start' || msg?.key === 'config') enforce(handler);
            const result = await message(msg);
            if (msg?.key === 'start' || msg?.key === 'config') enforce(handler);
            return result;
        };
    });
    on('connection/close', (handler: JudgeConnection) => { daemons.delete(handler); });

    async function judgeAccounts() {
        return UserModel.coll.find({ _id: { $gte: 2 }, priv: { $bitsAllSet: PRIV_JUDGE, $ne: -1 } })
            .project({ _id: 1, uname: 1, mail: 1, priv: 1, regat: 1, loginat: 1 }).sort({ _id: 1 }).toArray();
    }

    function serverUrl(origin: unknown) {
        const configured = SystemModel.get('server.url');
        if (typeof configured === 'string' && /^https?:\/\//.test(configured) && !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(configured)) return configured;
        if (typeof origin === 'string' && /^https?:\/\/[^\s/]+$/.test(origin)) return `${origin}/`;
        return typeof configured === 'string' && configured ? configured : '/';
    }

    async function issueConfig(uid: number, uname: string, origin: unknown) {
        const password = judgePassword();
        await UserModel.setPassword(uid, password);
        return judgeConfig({ serverUrl: serverUrl(origin), uname, password });
    }

    class JudgesHandler extends ManageHandler {
        async get() {
            this.response.template = 'xcpcio_manage_judges.html';
            this.response.body = {
                codeBase,
                runtimeJson: toScriptJson({
                    base: this.request.path, dataUrl: `${this.request.path}/data`, scopes: judgeScopes,
                    langs: Object.entries(SettingModel.langs || {}).filter(([, lang]) => !(lang as { remote?: unknown }).remote && !(lang as { hidden?: boolean }).hidden)
                        .map(([key, lang]) => [key, (lang as { display?: string }).display || key]),
                }),
            };
        }

        @param('payload', Types.String)
        async postCreate(_domainId: string, rawPayload: string) {
            const { uname: input, note, origin } = this.payload(rawPayload);
            const uname = checkJudgeName(input);
            if (await UserModel.coll.findOne({ unameLower: uname.toLowerCase() })) throw new ManageError(`账号 ${uname} 已存在`);
            const mail = `${uname.toLowerCase()}@judge.hydro.local`;
            if (await UserModel.coll.findOne({ mailLower: mail })) throw new ManageError(`邮箱 ${mail} 已被使用`);
            const password = judgePassword();
            const uid = await UserModel.create(mail, uname, password);
            await UserModel.setJudge(uid);
            const rule = normalizeJudgeRule({ ...defaultJudgeRule(), note });
            await rulesColl.updateOne({ _id: uid }, { $set: { ...rule, updatedAt: new Date(), updatedBy: this.user._id } }, { upsert: true });
            broadcast('xcpcio/judge-rules');
            this.response.body = { uid, uname, config: judgeConfig({ serverUrl: serverUrl(origin), uname, password }) };
        }

        /** Every copy issues a new password, so an earlier copy of the config stops working. */
        @param('payload', Types.String)
        async postCopy(_domainId: string, rawPayload: string) {
            const { uid, origin } = this.payload(rawPayload);
            const udoc = await UserModel.coll.findOne({ _id: Number(uid) });
            if (!udoc || udoc.priv === -1 || !(udoc.priv & PRIV_JUDGE)) throw new ManageError('评测机账号不存在', 404);
            this.response.body = { uname: udoc.uname, config: await issueConfig(udoc._id, udoc.uname, origin) };
        }

        @param('payload', Types.String)
        async postRule(_domainId: string, rawPayload: string) {
            const { uid, rule: input } = this.payload(rawPayload);
            const udoc = await UserModel.coll.findOne({ _id: Number(uid) });
            if (!udoc || udoc.priv === -1 || !(udoc.priv & PRIV_JUDGE)) throw new ManageError('评测机账号不存在', 404);
            const rule = normalizeJudgeRule(input);
            await rulesColl.updateOne({ _id: udoc._id }, { $set: { ...rule, updatedAt: new Date(), updatedBy: this.user._id } }, { upsert: true });
            rules.set(udoc._id, rule);
            for (const handler of daemons.keys()) if (handler.user?._id === udoc._id) enforce(handler);
            broadcast('xcpcio/judge-rules');
            this.response.body = { rule };
        }

        @param('payload', Types.String)
        async postDelete(_domainId: string, rawPayload: string) {
            const { uids: input, password } = this.payload(rawPayload);
            const uids = uidList(input, '评测机');
            if (!uids.length) throw new ManageError('请选择要删除的评测机');
            await this.verifyAdmin(password);
            const udocs = await UserModel.coll.find({ _id: { $in: uids } }).toArray();
            const deleted: number[] = [];
            const skipped: string[] = [];
            for (const udoc of udocs) {
                if (udoc.priv === -1 || !(udoc.priv & PRIV_JUDGE)) { skipped.push(`${udoc.uname} 不是评测机账号`); continue; }
                const reason = protectedReason(udoc, this.user._id, 'delete');
                if (reason) { skipped.push(reason); continue; }
                await deleteAccount(udoc, false);
                deleted.push(udoc._id);
            }
            for (const handler of daemons.keys()) if (handler.user && deleted.includes(handler.user._id)) handler.close?.(4000, 'Judge account deleted');
            if (deleted.length) broadcast('xcpcio/judge-rules');
            this.response.body = { deleted, skipped };
        }
    }

    class JudgesDataHandler extends ManageHandler {
        notUsage = true;

        async get() {
            const now = Date.now();
            const [accounts, ruleDocs, processes, queued, rejudges] = await Promise.all([
                judgeAccounts(),
                rulesColl.find({}).toArray() as Promise<JudgeRuleDoc[]>,
                raw('xcpcio.monitor.judges').find({ updateAt: { $gt: new Date(now - LIVE_MS) } }).toArray(),
                TaskModel.count({ type: 'judge' }),
                TaskModel.count({ type: 'judge', 'meta.rejudge': true }),
            ]);
            const ruleOf = new Map(ruleDocs.map((doc) => [doc._id, normalizeJudgeRule(doc)]));
            type Live = { uname: string | null; ip: string | null; concurrency: number | null; active: unknown[]; disconnectedAt: number | null; host: string | null; kind: string };
            const live = (processes as { judges?: Live[] }[]).flatMap((doc) => doc.judges || []).filter((judge) => judge.disconnectedAt === null);
            this.response.body = {
                queued, rejudges,
                builtin: live.filter((judge) => judge.kind === 'builtin').map((judge) => ({ host: judge.host, active: judge.active.length })),
                judges: accounts.map((udoc) => {
                    const connections = live.filter((judge) => judge.kind === 'remote' && judge.uname === udoc.uname);
                    return {
                        _id: udoc._id, uname: udoc.uname, regat: udoc.regat, loginat: udoc.loginat,
                        rule: ruleOf.get(udoc._id) ?? defaultJudgeRule(),
                        connections: connections.map((judge) => ({ ip: judge.ip, concurrency: judge.concurrency, active: judge.active.length })),
                    };
                }),
            };
        }
    }

    // ---------------------------------------------------------------- Rejudge

    async function domainOf(input: unknown, fallback: string) {
        const domainId = typeof input === 'string' && input.trim() ? input.trim() : fallback;
        if (!await DomainModel.get(domainId)) throw new ManageError(`域 ${domainId} 不存在`);
        return domainId;
    }

    /** Problem docIds for the typed problem numbers or ids (P1001, 1001). */
    async function resolveProblems(domainId: string, input: unknown) {
        if (!Array.isArray(input)) return [];
        const pids: number[] = [];
        for (const id of input.map((value) => String(value).trim()).filter(Boolean)) {
            const pdoc = await ProblemModel.get(domainId, id, ['docId']);
            if (!pdoc) throw new ManageError(`题目 ${id} 不存在于域 ${domainId}`);
            pids.push(pdoc.docId);
        }
        return pids;
    }

    async function selectRecords(domainId: string, input: Record<string, unknown>) {
        const selection = normalizeRejudgeSelection({ ...input, pids: [...(Array.isArray(input.pids) ? input.pids : []), ...await resolveProblems(domainId, input.problems)] });
        const tdoc = selection.contest ? await ContestModel.get(domainId, new ObjectId(selection.contest)) : null;
        if (selection.contest && !tdoc) throw new ManageError('比赛不存在', 404);
        if (tdoc && selection.pids.some((pid) => !tdoc.pids.includes(pid))) throw new ManageError('所选题目不属于该比赛');
        const filter = rejudgeFilter(selection, tdoc?.docId ?? null, [RecordModel.RECORD_PRETEST, RecordModel.RECORD_GENERATE]);
        const records = await RecordModel.getMulti(domainId, filter, { projection: { _id: 1, pid: 1, contest: 1, status: 1 } })
            .limit(MAX_REJUDGE + 1).toArray();
        if (records.length > MAX_REJUDGE) throw new ManageError(`符合条件的提交超过 ${MAX_REJUDGE} 条，请缩小范围`);
        return { selection, tdoc, records };
    }

    function summary(records: { pid: number; status: number }[], tdoc: { pids: number[] } | null) {
        const byStatus: Record<string, number> = {};
        for (const record of records) byStatus[record.status] = (byStatus[record.status] || 0) + 1;
        const byProblem = [...groupByProblem(records)].map(([pid, group]) => ({
            pid, label: tdoc && tdoc.pids.includes(pid) ? String.fromCharCode(65 + tdoc.pids.indexOf(pid)) : `#${pid}`, count: group.length,
        }));
        return { total: records.length, byStatus, byProblem };
    }

    class RejudgeHandler extends ManageHandler {
        async get() {
            this.response.template = 'xcpcio_manage_rejudge.html';
            this.response.body = {
                codeBase,
                runtimeJson: toScriptJson({ base: this.request.path, dataUrl: `${this.request.path}/data`, domainId: this.domain._id, statuses: rejudgeStatuses }),
            };
        }

        @param('payload', Types.String)
        async postPreview(domainId: string, rawPayload: string) {
            const input = this.payload(rawPayload);
            const target = await domainOf(input.domain, domainId);
            const { records, tdoc } = await selectRecords(target, input);
            this.response.body = summary(records, tdoc);
        }

        @param('payload', Types.String)
        async postRun(domainId: string, rawPayload: string) {
            const input = this.payload(rawPayload);
            const target = await domainOf(input.domain, domainId);
            await this.limitRate('xcpcio_manage_rejudge', 60, 10);
            const { records, tdoc } = await selectRecords(target, input);
            const failed: string[] = [];
            let queued = 0;
            for (const [pid, group] of groupByProblem(records)) {
                const pdoc = await ProblemModel.get(target, pid);
                if (!pdoc?.config || typeof pdoc.config === 'string') { failed.push(`#${pid} 题目配置无效，已跳过`); continue; }
                const ids = group.map((record) => record._id);
                // As Hydro's problem rejudge: below fresh submissions, contest records without details.
                const priority = await RecordModel.submissionPriority(this.user._id, -10000 - ids.length * 5 - 50);
                await RecordModel.reset(target, ids, true);
                const inContest = group.filter((record) => record.contest).map((record) => record._id);
                const outside = group.filter((record) => !record.contest).map((record) => record._id);
                await Promise.all([
                    RecordModel.judge(target, inContest, priority, { detail: false }, { rejudge: true }),
                    RecordModel.judge(target, outside, priority, {}, { rejudge: true }),
                ]);
                queued += ids.length;
            }
            this.response.body = { ...summary(records, tdoc), queued, failed };
        }
    }

    class RejudgeDataHandler extends ManageHandler {
        notUsage = true;

        @param('domain', Types.String, true)
        @param('contest', Types.String, true)
        async get(domainId: string, domainInput?: string, contest?: string) {
            const target = await domainOf(domainInput, domainId);
            if (contest) {
                if (!/^[a-f\d]{24}$/i.test(contest)) throw new ManageError('比赛编号无效');
                const tdoc = await ContestModel.get(target, new ObjectId(contest));
                if (!tdoc) throw new ManageError('比赛不存在', 404);
                const pdocs = await ProblemModel.getList(target, tdoc.pids, true, false, ['docId', 'pid', 'title']);
                this.response.body = {
                    problems: tdoc.pids.map((pid, index) => ({
                        pid, label: String.fromCharCode(65 + index), title: (pdocs as Record<number, { title?: string }>)[pid]?.title || `#${pid}`,
                    })),
                };
                return;
            }
            const tdocs = await ContestModel.getMulti(target, {}).limit(200).project({ docId: 1, title: 1, beginAt: 1, endAt: 1, rule: 1, pids: 1 }).toArray();
            this.response.body = {
                domainId: target,
                contests: tdocs.map((tdoc) => ({ id: `${tdoc.docId}`, title: tdoc.title, beginAt: tdoc.beginAt, endAt: tdoc.endAt, rule: tdoc.rule, problems: tdoc.pids?.length || 0 })),
            };
        }
    }

    ctx.Route('manage_xcpcio_users', '/manage/xcpcio-users', UsersHandler);
    ctx.Route('manage_xcpcio_users_data', '/manage/xcpcio-users/data', UsersDataHandler);
    ctx.Route('manage_xcpcio_judges', '/manage/xcpcio-judges', JudgesHandler);
    ctx.Route('manage_xcpcio_judges_data', '/manage/xcpcio-judges/data', JudgesDataHandler);
    ctx.Route('manage_xcpcio_rejudge', '/manage/xcpcio-rejudge', RejudgeHandler);
    ctx.Route('manage_xcpcio_rejudge_data', '/manage/xcpcio-rejudge/data', RejudgeDataHandler);
    // User configuration directly below Hydro's "Import User"; the others at the end of the menu.
    ctx.injectUI('ControlPanel', 'manage_xcpcio_users', { before: 'manage_user_priv' }, PRIV.PRIV_EDIT_SYSTEM);
    ctx.injectUI('ControlPanel', 'manage_xcpcio_judges', {}, PRIV.PRIV_EDIT_SYSTEM);
    ctx.injectUI('ControlPanel', 'manage_xcpcio_rejudge', {}, PRIV.PRIV_EDIT_SYSTEM);
    ctx.i18n.load('zh', { manage_xcpcio_users: '用户配置', manage_xcpcio_judges: '评测机控制', manage_xcpcio_rejudge: '批量重测' });
    ctx.i18n.load('en', { manage_xcpcio_users: 'User Configuration', manage_xcpcio_judges: 'Judge Control', manage_xcpcio_rejudge: 'Batch Rejudge' });
}
