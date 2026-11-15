/**
 * Judge monitoring: every judge machine's load and performance, live judging, and the contest's
 * waiting submissions. Pure computation over the live judge tracking (judge-tracker.ts), the
 * machines' reports and the contest's records (see monitor-routes.ts), so it is tested without Hydro.
 */
import type { ActiveTask, FinishedTask, TaskInfo, TrackedJudge } from './judge-tracker';

export interface MonitorRecord {
    id: string;
    /** Submission time, from the record id. */
    submittedAt: number;
    status: number;
    uid: number;
    pid: number;
    lang: string;
    judgeAt?: number | null;
    rejudged?: boolean;
}

/** CPU, memory and temperature of a machine: sampled live (built-in judge) or as last reported (daemons). */
export interface MachineMetrics {
    cpu: number | null;
    memoryRate: number | null;
    memoryTotal: number | null;
    temperature: number | null;
    cores: number | null;
    model: string | null;
    os: string | null;
    compilers: number | null;
    /** When the numbers were reported; null when sampled live. */
    reportedAt: number | null;
}

export interface MonitorMachine {
    key: string;
    name: string;
    kind: 'remote' | 'builtin';
    /** Live judging, absent for a daemon known only from its reports (not connected now). */
    tracked: TrackedJudge | null;
    metrics: MachineMetrics | null;
}

export interface MonitorInput {
    now: number;
    contest: { domainId: string; id: string };
    records: MonitorRecord[];
    machines: MonitorMachine[];
    /** Judge tasks waiting in Hydro's queue (all contests and problems). */
    queueLength: number;
    problems: { pid: number; label: string }[];
    teamOf: (uid: number) => { id: string; name: string } | null;
}

/** Hydro STATUS codes (@hydrooj/common status.ts). */
const PENDING = new Set([0, 20, 21, 22]);
const SYSTEM_ERROR = new Set([8, 10]);
const statusLabels: Record<number, string> = {
    0: '等待评测', 20: '评测中', 21: '编译中', 22: '已取走',
    1: '通过', 2: '答案错误', 3: '超时', 4: '超内存', 5: '输出超限', 6: '运行错误', 7: '编译错误', 8: '系统错误', 10: '系统错误',
    9: '已取消', 11: '其他', 30: '已忽略', 31: '格式错误', 32: 'Hack 成功', 33: 'Hack 失败',
};
export const statusLabel = (status: number) => statusLabels[status] ?? `状态 ${status}`;
const resultTone = (status: number) => (status === 1 ? 'ok' : SYSTEM_ERROR.has(status) ? 'error' : status === 7 ? 'muted' : 'bad');

/** Alert thresholds (no external push yet: shown on the page). */
export const thresholds = {
    /** A submission waiting longer than this. */
    pendingSeconds: 180,
    /** At least `systemErrors` system errors within `systemErrorWindowSeconds`. */
    systemErrors: 3,
    systemErrorWindowSeconds: 300,
    /** A daemon's report older than this (it reports every 20 minutes) means the machine is gone. */
    reportStaleSeconds: 25 * 60,
    /** Waiting work with nothing judged for this long means judging has stopped. */
    stalledSeconds: 180,
    /** Machine pressure worth a warning. */
    cpuPercent: 95,
    memoryPercent: 90,
};

const percentile = (values: number[], p: number) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const round1 = (value: number) => Math.round(value * 10) / 10;
const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));

export function monitorSnapshot(input: MonitorInput) {
    const { now, records } = input;
    const label = new Map(input.problems.map((problem) => [problem.pid, problem.label]));
    const ordered = [...records].sort((a, b) => a.submittedAt - b.submittedAt);
    const pending = ordered.filter((record) => PENDING.has(record.status));
    const oldestPendingSeconds = pending.length ? seconds(now - pending[0].submittedAt) : 0;
    const latencies = ordered
        .filter((record) => !PENDING.has(record.status) && !record.rejudged && record.judgeAt && now - record.judgeAt <= 15 * 60_000)
        .map((record) => Math.max(0, (record.judgeAt! - record.submittedAt) / 1000));
    const systemErrors = ordered.filter((record) => SYSTEM_ERROR.has(record.status));
    const recentSystemErrors = systemErrors.filter((record) => now - (record.judgeAt || record.submittedAt) <= thresholds.systemErrorWindowSeconds * 1000);
    const describe = (record: MonitorRecord) => {
        const team = input.teamOf(record.uid);
        return {
            id: record.id, team: team?.name ?? `非参赛者 ${record.uid}`, problem: label.get(record.pid) ?? '?', lang: record.lang,
            status: statusLabel(record.status), ageSeconds: seconds(now - record.submittedAt),
        };
    };

    // A task of this contest shows its team and problem; other domains' and contests' work only its language.
    const subject = (task: TaskInfo) => {
        if (task.domainId !== input.contest.domainId || task.contest !== input.contest.id) return { inContest: false as const, rid: null, team: null, problem: null, lang: task.lang };
        return { inContest: true as const, rid: task.rid, team: input.teamOf(task.uid)?.name ?? `非参赛者 ${task.uid}`, problem: label.get(task.pid) ?? '?', lang: task.lang };
    };

    const nowMinute = Math.floor(now / 60_000);
    const machines = input.machines.map((machine) => {
        const tracked = machine.tracked;
        const online = !!tracked && tracked.disconnectedAt === null;
        const window = (minutes: number) => (tracked?.minutes || []).filter((bucket) => bucket.minute > nowMinute - minutes);
        const sum = (minutes: number, key: 'judged' | 'accepted' | 'systemErrors' | 'durationSum' | 'durationCount') => window(minutes).reduce((total, bucket) => total + bucket[key], 0);
        const durations = sum(15, 'durationCount');
        const active = online ? tracked!.active : [];
        const metrics = machine.metrics;
        const reportedSecondsAgo = metrics?.reportedAt == null ? null : seconds(now - metrics.reportedAt);
        const state = !online ? 'offline' : active.length ? 'busy' : 'idle';
        return {
            key: machine.key,
            name: machine.name,
            kind: machine.kind,
            state,
            online,
            /** Known only from its reports: not connected to Hydro now. */
            reportOnly: !tracked,
            account: tracked?.uname ?? null,
            ip: tracked?.ip ?? null,
            connectedSeconds: online ? seconds(now - tracked!.connectedAt) : null,
            disconnectedSeconds: tracked?.disconnectedAt != null ? seconds(now - tracked.disconnectedAt) : null,
            concurrency: tracked?.concurrency ?? null,
            langs: tracked?.langs ?? null,
            activeCount: active.length,
            /** Percent of the daemon's concurrency in use. */
            utilization: tracked?.concurrency ? Math.round((active.length / tracked.concurrency) * 100) : null,
            judged1: (tracked?.finishTimes || []).filter((time) => now - time <= 60_000).length,
            judged5: sum(5, 'judged'),
            judged15: sum(15, 'judged'),
            accepted15: sum(15, 'accepted'),
            systemErrors5: sum(5, 'systemErrors'),
            systemErrors15: sum(15, 'systemErrors'),
            totalJudged: tracked?.totals.judged ?? 0,
            /** Judgements of the last 15 minutes whose start was seen, so their duration is known. */
            timed15: durations,
            averageSeconds: durations ? round1(sum(15, 'durationSum') / durations / 1000) : null,
            maxSeconds: durations ? round1(Math.max(...window(15).map((bucket) => bucket.durationMax)) / 1000) : null,
            lastFinishedSeconds: tracked?.recent.length ? seconds(now - tracked.recent[0].at) : null,
            /** Judged per minute over the last 30 minutes, oldest first. */
            perMinute: Array.from({ length: 30 }, (_, index) => window(30).find((bucket) => bucket.minute === nowMinute - 29 + index)?.judged ?? 0),
            metrics: metrics ? { ...metrics, reportedSecondsAgo, live: metrics.reportedAt === null } : null,
        };
    }).sort((a, b) => Number(b.online) - Number(a.online) || (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'builtin' ? -1 : 1));

    const nameOf = new Map(input.machines.map((machine) => [machine.key, machine.name]));
    const live = input.machines.flatMap((machine) => (machine.tracked && machine.tracked.disconnectedAt === null ? machine.tracked.active : [])
        .map((task: ActiveTask) => ({
            judge: nameOf.get(machine.key)!, ...subject(task), status: statusLabel(task.status), casesDone: task.casesDone,
            progress: task.progress, elapsedSeconds: seconds(now - task.startedAt),
        })))
        .sort((a, b) => b.elapsedSeconds - a.elapsedSeconds);
    const finished = input.machines.flatMap((machine) => (machine.tracked?.recent || []).map((task: FinishedTask) => ({
        judge: nameOf.get(machine.key)!, ...subject(task), at: task.at, status: statusLabel(task.status), tone: resultTone(task.status),
        durationSeconds: task.durationMs === null ? null : round1(task.durationMs / 1000), timeMs: task.timeMs, memoryKb: task.memoryKb,
        agoSeconds: seconds(now - task.at),
    }))).sort((a, b) => b.at - a.at).slice(0, 30);

    const alerts: { level: 'error' | 'warning'; text: string }[] = [];
    if (!machines.some((machine) => machine.online)) alerts.push({ level: 'error', text: '没有在线的评测机' });
    for (const machine of machines) {
        if (machine.disconnectedSeconds !== null && !machine.online) {
            alerts.push({ level: 'warning', text: `评测机 ${machine.name} 在 ${Math.max(1, Math.floor(machine.disconnectedSeconds / 60))} 分钟前断开连接` });
        } else if (machine.reportOnly && machine.metrics?.reportedSecondsAgo != null && machine.metrics.reportedSecondsAgo <= thresholds.reportStaleSeconds) {
            alerts.push({ level: 'warning', text: `评测机 ${machine.name} 没有连接到 Hydro（${Math.floor(machine.metrics.reportedSecondsAgo / 60)} 分钟前还有上报）` });
        }
        if (machine.systemErrors5 >= thresholds.systemErrors) {
            alerts.push({ level: 'error', text: `评测机 ${machine.name} 最近 5 分钟出现 ${machine.systemErrors5} 次系统错误` });
        }
        const fresh = machine.metrics && (machine.metrics.live || (machine.metrics.reportedSecondsAgo ?? Infinity) <= thresholds.reportStaleSeconds);
        if (machine.online && fresh && machine.metrics!.cpu !== null && machine.metrics!.cpu >= thresholds.cpuPercent) {
            alerts.push({ level: 'warning', text: `评测机 ${machine.name} CPU 使用率 ${Math.round(machine.metrics!.cpu)}%${machine.metrics!.live ? '' : '（上报值）'}` });
        }
        if (machine.online && fresh && machine.metrics!.memoryRate !== null && machine.metrics!.memoryRate >= thresholds.memoryPercent) {
            alerts.push({ level: 'warning', text: `评测机 ${machine.name} 内存占用 ${Math.round(machine.metrics!.memoryRate)}%${machine.metrics!.live ? '' : '（上报值）'}` });
        }
    }
    // Judged records show directly whether judging moves.
    const lastJudgedAt = Math.max(0, ...ordered.filter((record) => !PENDING.has(record.status) && record.judgeAt).map((record) => record.judgeAt!),
        ...machines.map((machine) => (machine.lastFinishedSeconds === null ? 0 : now - machine.lastFinishedSeconds * 1000)));
    const stalled = pending.length > 0 && oldestPendingSeconds > thresholds.stalledSeconds
        && now - Math.max(lastJudgedAt, pending[0].submittedAt) > thresholds.stalledSeconds * 1000;
    if (stalled) {
        alerts.push({ level: 'error', text: `评测似乎停止：${pending.length} 条提交等待中，最近 ${thresholds.stalledSeconds / 60} 分钟没有完成任何评测` });
    } else if (oldestPendingSeconds > thresholds.pendingSeconds) {
        alerts.push({ level: 'warning', text: `有提交已等待评测 ${Math.floor(oldestPendingSeconds / 60)} 分 ${oldestPendingSeconds % 60} 秒` });
    }
    if (recentSystemErrors.length >= thresholds.systemErrors) {
        alerts.push({ level: 'error', text: `本场比赛最近 ${thresholds.systemErrorWindowSeconds / 60} 分钟出现 ${recentSystemErrors.length} 次系统错误` });
    }

    const online = machines.filter((machine) => machine.online);
    const durationCount = machines.reduce((total, machine) => total + machine.timed15, 0);
    return {
        now,
        summary: {
            judgesOnline: online.length,
            judgesTotal: machines.length,
            activeTasks: live.length,
            /** Sum of the online daemons' concurrency; built-in judges' is unknown. */
            capacity: online.reduce((total, machine) => total + (machine.concurrency ?? 0), 0),
            capacityKnown: online.every((machine) => machine.concurrency !== null),
            judgedPerMinute: round1(online.reduce((total, machine) => total + machine.judged5, 0) / 5),
            judged15: machines.reduce((total, machine) => total + machine.judged15, 0),
            averageJudgeSeconds: durationCount
                ? round1(machines.reduce((total, machine) => total + (machine.averageSeconds ?? 0) * machine.timed15, 0) / durationCount) : null,
            queueLength: input.queueLength,
            total: ordered.length,
            accepted: ordered.filter((record) => record.status === 1).length,
            pending: pending.length,
            oldestPendingSeconds,
            systemErrors: systemErrors.length,
            judgedRecently: latencies.length,
            averageLatencySeconds: latencies.length ? round1(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
            p95LatencySeconds: percentile(latencies, 95),
        },
        alerts,
        machines,
        live,
        finished,
        pending: pending.slice(0, 30).map(describe),
        systemErrors: systemErrors.slice(-10).reverse().map(describe),
    };
}

export type MonitorSnapshot = ReturnType<typeof monitorSnapshot>;
