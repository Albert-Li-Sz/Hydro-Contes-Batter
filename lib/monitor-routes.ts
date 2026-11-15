import fs from 'node:fs';
import path from 'node:path';
import {
    ContestModel, Context, getAlphabeticId, Handler, NotFoundError, ObjectId, param, PERM, PRIV, RecordModel, TaskModel, Tdoc, Types, UserModel,
} from 'hydrooj';
import { monitorSnapshot, type MonitorRecord, type MonitorSnapshot } from './monitor';
import { resolverCodeBase } from './resolver-data';
import { toScriptJson } from './settings';
import { describeTeam, isTeamEntry, memberIds, type TeamEntry } from './teams';

/** Judge monitoring page for contest managers (no external alerts yet). */
export function applyMonitor(ctx: Context) {
    const version = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version;
    const codeBase = resolverCodeBase(version);
    // Judge machines report to Hydro's `status` collection (handler/status.ts).
    const judgeStatus = ctx.db.collection('status' as never) as unknown as {
        find: (query: object, options?: object) => { toArray: () => Promise<{ mid?: unknown; updateAt?: unknown }[]> };
    };
    const contestBase = (tdoc: Tdoc) => `/d/${encodeURIComponent(tdoc.domainId)}/contest/${tdoc.docId}`;
    // Every open monitor polls; one computation per contest and identity view every few seconds.
    const cache = new Map<string, { expires: number; value: Promise<MonitorSnapshot> }>();

    async function snapshot(tdoc: Tdoc, identity: boolean): Promise<MonitorSnapshot> {
        const entries = await ContestModel.getMultiStatus(tdoc.domainId, { docId: tdoc.docId }).toArray() as unknown as TeamEntry[];
        const users = await UserModel.getList(tdoc.domainId, [...entries.map((entry) => entry.uid), ...memberIds(tdoc, entries)]);
        // Team contests: members submit, the team is credited.
        const teamOf = new Map<number, { id: string; name: string }>();
        for (const entry of entries) {
            const team = describeTeam(entry, users, identity);
            if (!team) continue;
            const value = { id: `${entry.uid}`, name: team.name };
            teamOf.set(entry.uid, value);
            if (isTeamEntry(entry)) for (const member of entry.members) teamOf.set(member, value);
        }
        const [records, queueLength, judges] = await Promise.all([
            RecordModel.getMulti(tdoc.domainId, { contest: tdoc.docId }, {
                projection: { _id: 1, status: 1, uid: 1, pid: 1, lang: 1, judgeAt: 1, rejudged: 1 },
            }).toArray(),
            TaskModel.count({ type: 'judge' }),
            judgeStatus.find({ type: 'judge' }, { projection: { mid: 1, updateAt: 1 } }).toArray(),
        ]);
        return monitorSnapshot({
            now: Date.now(), beginAt: tdoc.beginAt.getTime(), endAt: tdoc.endAt.getTime(),
            records: records.map((record): MonitorRecord => ({
                id: `${record._id}`, submittedAt: new ObjectId(record._id).getTimestamp().getTime(), status: record.status,
                uid: record.uid, pid: record.pid, lang: record.lang,
                judgeAt: record.judgeAt ? new Date(record.judgeAt).getTime() : null, rejudged: !!record.rejudged,
            })),
            judges: judges.filter((judge) => typeof judge.mid === 'string' || typeof judge.mid === 'number')
                .map((judge) => ({ mid: String(judge.mid), updateAt: new Date(judge.updateAt as string).getTime() || 0 })),
            queueLength,
            problems: tdoc.pids.map((pid, index) => ({ pid, label: getAlphabeticId(index) })),
            teamOf: (uid) => teamOf.get(uid) ?? null,
        });
    }

    class MonitorHandler extends Handler {
        tdoc!: Tdoc;

        @param('tid', Types.ObjectId)
        async prepare(_domainId: string, tid: ObjectId) {
            this.response.addHeader('Cache-Control', 'no-store');
            const tdoc = await ContestModel.get(this.domain._id, tid);
            if (!tdoc) throw new NotFoundError('Contest not found');
            this.checkPriv(PRIV.PRIV_USER_PROFILE);
            if (!this.user.own(tdoc)) this.checkPerm(PERM.PERM_EDIT_CONTEST);
            this.tdoc = tdoc;
        }

        async get() {
            const base = contestBase(this.tdoc);
            this.response.template = 'xcpcio_monitor.html';
            this.response.body = {
                tdoc: this.tdoc, codeBase,
                runtimeJson: toScriptJson({ dataUrl: `${base}/monitor/data`, contestUrl: base, title: this.tdoc.title, refreshMs: 5000 }),
            };
        }
    }

    class MonitorDataHandler extends MonitorHandler {
        notUsage = true;

        async get() {
            // Real names only for those who may see private user information, as on the board.
            const identity = this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO);
            const key = `${this.tdoc.domainId}/${this.tdoc.docId}/${identity ? 1 : 0}`;
            const now = Date.now();
            for (const [name, entry] of cache) if (entry.expires <= now) cache.delete(name);
            let entry = cache.get(key);
            if (!entry) {
                entry = { expires: now + 3000, value: snapshot(this.tdoc, identity) };
                entry.value.catch(() => cache.delete(key));
                cache.set(key, entry);
            }
            this.response.type = 'application/json';
            this.response.body = JSON.stringify(await entry.value);
        }
    }

    ctx.Route('contest_xcpcio_monitor', '/contest/:tid/monitor', MonitorHandler);
    ctx.Route('contest_xcpcio_monitor_data', '/contest/:tid/monitor/data', MonitorDataHandler);
    ctx.i18n.load('zh', { contest_xcpcio_monitor: '评测监控' });
}
