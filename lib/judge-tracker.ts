/**
 * Live judging per judge machine, as one Hydro process sees it: tasks handed to each judge
 * daemon's WebSocket and their results, and the built-in hydrojudge's tasks in this process.
 * Pure state, fed by monitor-routes.ts; each process publishes a snapshot so the monitor can
 * merge all PM2 instances.
 */

export interface TaskInfo {
    rid: string;
    domainId: string;
    uid: number;
    pid: number;
    lang: string;
    /** Contest id, or null outside contests. */
    contest: string | null;
}

export interface ActiveTask extends TaskInfo {
    startedAt: number;
    /** Hydro STATUS code of the latest progress report (22 fetched, 21 compiling, 20 judging). */
    status: number;
    casesDone: number;
    /** Percent, when the judge reports it. */
    progress: number | null;
}

export interface FinishedTask extends TaskInfo {
    at: number;
    status: number;
    /** From handing the task to the judge until its result; null when the start was not seen. */
    durationMs: number | null;
    /** The submission's own run time and memory, as judged. */
    timeMs: number | null;
    memoryKb: number | null;
}

export interface MinuteBucket {
    /** Minutes since the epoch. */
    minute: number;
    judged: number;
    accepted: number;
    systemErrors: number;
    durationSum: number;
    durationCount: number;
    durationMax: number;
}

export interface TrackedJudge {
    id: string;
    kind: 'remote' | 'builtin';
    /** Hydro account the daemon logs in with (remote). */
    uname: string | null;
    ip: string | null;
    /** Machine id from the daemon's status reports, the key of its entry in Hydro's `status` collection. */
    mid: string | null;
    host: string | null;
    connectedAt: number;
    disconnectedAt: number | null;
    /** Tasks the daemon takes at once (its `config` message); null when unknown. */
    concurrency: number | null;
    langs: string[] | null;
    active: ActiveTask[];
    minutes: MinuteBucket[];
    /** Finish times of the last two minutes, for an exact one-minute count. */
    finishTimes: number[];
    recent: FinishedTask[];
    totals: { judged: number; systemErrors: number };
}

const KEEP_MINUTES = 30;
const KEEP_RECENT = 20;
/** Disconnected judges stay listed this long, so the monitor shows what happened. */
export const KEEP_DISCONNECTED_MS = 10 * 60_000;
/** A built-in task with no news for this long was finished elsewhere or abandoned. */
const ACTIVE_EXPIRE_MS = 10 * 60_000;
const ACCEPTED = 1;
const SYSTEM_ERRORS = new Set([8, 10]);
const FINAL = (status: number) => status !== 0 && !(status >= 20 && status <= 22);

export function taskInfo(task: Record<string, unknown>): TaskInfo | null {
    const rid = task.rid ?? task._id;
    if (!rid || typeof task.domainId !== 'string') return null;
    return {
        rid: String(rid), domainId: task.domainId, uid: Number(task.uid) || 0, pid: Number(task.pid) || 0,
        lang: typeof task.lang === 'string' ? task.lang : '', contest: task.contest ? String(task.contest) : null,
    };
}

export class JudgeTracker {
    judges = new Map<string, TrackedJudge>();
    /** Tasks handed to judge daemons in this process: their results are not the built-in judge's. */
    private remoteRids = new Set<string>();

    constructor(private host: string, private now: () => number = Date.now) {}

    connect(id: string, info: { uname: string | null; ip: string | null }) {
        this.judges.set(id, {
            id, kind: 'remote', uname: info.uname, ip: info.ip, mid: null, host: null, connectedAt: this.now(), disconnectedAt: null,
            concurrency: 1, langs: null, active: [], minutes: [], finishTimes: [], recent: [], totals: { judged: 0, systemErrors: 0 },
        });
    }

    /** The daemon's own messages: `config` (concurrency, languages) and `status` (machine id). */
    message(id: string, msg: Record<string, any>) {
        const judge = this.judges.get(id);
        if (!judge || !msg || typeof msg !== 'object') return;
        if (msg.key === 'config') {
            if (Number.isSafeInteger(msg.concurrency) && msg.concurrency > 0) judge.concurrency = msg.concurrency;
            if (Array.isArray(msg.lang) && msg.lang.every((lang: unknown) => typeof lang === 'string')) judge.langs = msg.lang;
        } else if (msg.key === 'status' && msg.info && (typeof msg.info.mid === 'string' || typeof msg.info.mid === 'number')) {
            judge.mid = String(msg.info.mid);
        } else if (msg.key === 'next' && msg.rid) {
            this.progress(judge, String(msg.rid), msg);
        } else if (msg.key === 'end' && msg.rid && !msg.nop) {
            this.finish(judge, String(msg.rid), msg);
        }
    }

    taskStart(id: string, task: TaskInfo) {
        const judge = this.judges.get(id);
        if (!judge) return;
        this.remoteRids.add(task.rid);
        judge.active = judge.active.filter((item) => item.rid !== task.rid);
        judge.active.push({ ...task, startedAt: this.now(), status: 22, casesDone: 0, progress: null });
    }

    /** The daemon gave the task up (disconnect, failure): Hydro queues it again. */
    taskDone(id: string, rid: string) {
        const judge = this.judges.get(id);
        if (judge) judge.active = judge.active.filter((item) => item.rid !== rid);
        this.remoteRids.delete(rid);
    }

    disconnect(id: string) {
        const judge = this.judges.get(id);
        if (!judge) return;
        judge.disconnectedAt = this.now();
        for (const task of judge.active) this.remoteRids.delete(task.rid);
        judge.active = [];
    }

    /** Built-in judge: Hydro's record/change broadcast, for tasks no daemon here holds. */
    builtinChange(task: TaskInfo, status: number, casesDone: number, progress: number | null) {
        if (this.remoteRids.has(task.rid) || status === 0) return; // a daemon's, or queued and not taken yet
        const judge = this.builtin();
        const current = judge.active.find((item) => item.rid === task.rid);
        if (FINAL(status)) {
            judge.active = judge.active.filter((item) => item.rid !== task.rid);
            return;
        }
        if (current) Object.assign(current, { status, casesDone, progress });
        else judge.active.push({ ...task, startedAt: this.now(), status, casesDone, progress });
    }

    /** Built-in judge: Hydro's record/judge, which fires in the process that judged the record. */
    builtinFinish(task: TaskInfo, result: { status: number; time?: number; memory?: number }) {
        if (this.remoteRids.has(task.rid)) {
            this.remoteRids.delete(task.rid);
            return;
        }
        const judge = this.builtin();
        const started = judge.active.find((item) => item.rid === task.rid)?.startedAt;
        judge.active = judge.active.filter((item) => item.rid !== task.rid);
        this.record(judge, task, result, started);
    }

    /** Serializable state for this process, dropping what is too old to show. */
    snapshot(): TrackedJudge[] {
        const now = this.now();
        const minute = Math.floor(now / 60_000);
        for (const [id, judge] of this.judges) {
            if (judge.disconnectedAt !== null && now - judge.disconnectedAt > KEEP_DISCONNECTED_MS) {
                this.judges.delete(id);
                continue;
            }
            judge.minutes = judge.minutes.filter((bucket) => bucket.minute > minute - KEEP_MINUTES);
            judge.finishTimes = judge.finishTimes.filter((time) => now - time < 120_000);
            if (judge.kind === 'builtin') judge.active = judge.active.filter((task) => now - task.startedAt < ACTIVE_EXPIRE_MS);
        }
        return structuredClone([...this.judges.values()]);
    }

    /** The built-in judge of this server, listed even before it judges anything. */
    builtin() {
        const id = `builtin:${this.host}`;
        let judge = this.judges.get(id);
        if (!judge) {
            judge = {
                id, kind: 'builtin', uname: null, ip: null, mid: null, host: this.host, connectedAt: this.now(), disconnectedAt: null,
                concurrency: null, langs: null, active: [], minutes: [], finishTimes: [], recent: [], totals: { judged: 0, systemErrors: 0 },
            };
            this.judges.set(id, judge);
        }
        return judge;
    }

    private progress(judge: TrackedJudge, rid: string, msg: Record<string, any>) {
        const task = judge.active.find((item) => item.rid === rid);
        if (!task) return;
        if (Number.isSafeInteger(msg.status)) task.status = msg.status;
        task.casesDone += Array.isArray(msg.cases) ? msg.cases.length : msg.case ? 1 : 0;
        if (Number.isFinite(msg.progress)) task.progress = Math.max(0, Math.min(100, msg.progress));
        else if (Number.isFinite(msg.addProgress)) task.progress = Math.max(0, Math.min(100, (task.progress ?? 0) + msg.addProgress));
    }

    private finish(judge: TrackedJudge, rid: string, msg: Record<string, any>) {
        const task = judge.active.find((item) => item.rid === rid);
        if (!task) return;
        judge.active = judge.active.filter((item) => item.rid !== rid);
        // remoteRids keeps the rid until record/judge, so the built-in side does not count it again.
        this.record(judge, task, { status: msg.status, time: msg.time, memory: msg.memory }, task.startedAt);
    }

    private record(judge: TrackedJudge, task: TaskInfo, result: { status: number; time?: number; memory?: number }, startedAt?: number) {
        const now = this.now();
        const status = Number.isSafeInteger(result.status) ? result.status : 8;
        const durationMs = startedAt === undefined ? null : Math.max(0, now - startedAt);
        const finished: FinishedTask = {
            rid: task.rid, domainId: task.domainId, uid: task.uid, pid: task.pid, lang: task.lang, contest: task.contest,
            at: now, status, durationMs,
            timeMs: Number.isFinite(result.time) ? result.time! : null,
            memoryKb: Number.isFinite(result.memory) ? result.memory! : null,
        };
        judge.recent = [finished, ...judge.recent].slice(0, KEEP_RECENT);
        judge.finishTimes.push(now);
        const minute = Math.floor(now / 60_000);
        let bucket = judge.minutes.find((item) => item.minute === minute);
        if (!bucket) {
            bucket = { minute, judged: 0, accepted: 0, systemErrors: 0, durationSum: 0, durationCount: 0, durationMax: 0 };
            judge.minutes.push(bucket);
        }
        bucket.judged++;
        judge.totals.judged++;
        if (status === ACCEPTED) bucket.accepted++;
        if (SYSTEM_ERRORS.has(status)) {
            bucket.systemErrors++;
            judge.totals.systemErrors++;
        }
        if (durationMs !== null) {
            bucket.durationSum += durationMs;
            bucket.durationCount++;
            bucket.durationMax = Math.max(bucket.durationMax, durationMs);
        }
    }
}

/**
 * All processes' snapshots as one list of judges: daemons per connection, the built-in judge per
 * server (every process on a server runs it). A task a daemon holds is never the built-in judge's.
 */
export function mergeJudges(processes: { host: string; judges: TrackedJudge[] }[]): TrackedJudge[] {
    const remote = processes.flatMap((item) => item.judges.filter((judge) => judge.kind === 'remote'));
    const remoteRids = new Set(remote.flatMap((judge) => judge.active.map((task) => task.rid)));
    const builtin = new Map<string, TrackedJudge>();
    for (const judge of processes.flatMap((item) => item.judges.filter((entry) => entry.kind === 'builtin'))) {
        const host = judge.host || '';
        const merged = builtin.get(host);
        if (!merged) {
            builtin.set(host, { ...structuredClone(judge), id: `builtin:${host}` });
            continue;
        }
        merged.connectedAt = Math.min(merged.connectedAt, judge.connectedAt);
        merged.active.push(...judge.active.filter((task) => !merged.active.some((item) => item.rid === task.rid)));
        merged.recent = [...merged.recent, ...judge.recent].sort((a, b) => b.at - a.at).slice(0, KEEP_RECENT);
        merged.finishTimes.push(...judge.finishTimes);
        merged.totals.judged += judge.totals.judged;
        merged.totals.systemErrors += judge.totals.systemErrors;
        for (const bucket of judge.minutes) {
            const target = merged.minutes.find((item) => item.minute === bucket.minute);
            if (!target) merged.minutes.push({ ...bucket });
            else {
                target.judged += bucket.judged;
                target.accepted += bucket.accepted;
                target.systemErrors += bucket.systemErrors;
                target.durationSum += bucket.durationSum;
                target.durationCount += bucket.durationCount;
                target.durationMax = Math.max(target.durationMax, bucket.durationMax);
            }
        }
    }
    for (const judge of builtin.values()) judge.active = judge.active.filter((task) => !remoteRids.has(task.rid));
    return [...remote, ...builtin.values()];
}
