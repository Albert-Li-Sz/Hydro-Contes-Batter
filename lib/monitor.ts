/**
 * Judge monitoring for a contest: what the judges' room watches during the contest. Pure
 * computation over Hydro's records, judge task queue and judge machine reports (see
 * monitor-routes.ts), so it can be tested without Hydro.
 */

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

export interface MonitorJudge {
    mid: string;
    updateAt: number;
    [key: string]: unknown;
}

export interface MonitorInput {
    now: number;
    beginAt: number;
    endAt: number;
    records: MonitorRecord[];
    judges: MonitorJudge[];
    /** Judge tasks waiting in Hydro's queue (all contests and problems). */
    queueLength: number;
    problems: { pid: number; label: string }[];
    teamOf: (uid: number) => { id: string; name: string } | null;
}

/** Hydro STATUS codes (@hydrooj/common status.ts). */
const PENDING = new Set([0, 20, 21, 22]);
const SYSTEM_ERROR = new Set([8, 10]);
export const categories: { key: string; label: string; codes: number[] }[] = [
    { key: 'AC', label: '通过', codes: [1] },
    { key: 'WA', label: '答案错误', codes: [2] },
    { key: 'TLE', label: '超时', codes: [3] },
    { key: 'MLE', label: '超内存', codes: [4] },
    { key: 'RE', label: '运行错误', codes: [6] },
    { key: 'CE', label: '编译错误', codes: [7] },
    { key: 'OLE', label: '输出超限', codes: [5] },
    { key: 'PE', label: '格式错误', codes: [31] },
    { key: 'SE', label: '系统错误', codes: [8, 10] },
    { key: 'PENDING', label: '评测中', codes: [0, 20, 21, 22] },
    { key: 'OTHER', label: '其他', codes: [9, 11, 30, 32, 33] },
];
const categoryOf = (status: number) => categories.find((category) => category.codes.includes(status))?.key || 'OTHER';
const statusLabels: Record<number, string> = { 0: '等待评测', 20: '评测中', 21: '编译中', 22: '已取走' };

/** Alert thresholds (no external push yet: shown on the page). */
export const thresholds = {
    /** A submission waiting longer than this. */
    pendingSeconds: 180,
    /** At least `systemErrors` system errors within `systemErrorWindowSeconds`. */
    systemErrors: 3,
    systemErrorWindowSeconds: 300,
    /** Hydro counts a judge machine offline after five minutes without a report. */
    judgeOfflineSeconds: 300,
    /** Judge reports older than this are machines retired long ago, not alerts. */
    judgeForgetSeconds: 6 * 3600,
};

const percentile = (values: number[], p: number) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

export function monitorSnapshot(input: MonitorInput) {
    const { now, records } = input;
    const label = new Map(input.problems.map((problem) => [problem.pid, problem.label]));
    const ordered = [...records].sort((a, b) => a.submittedAt - b.submittedAt);
    const pending = ordered.filter((record) => PENDING.has(record.status));
    const oldestPendingSeconds = pending.length ? Math.max(0, Math.floor((now - pending[0].submittedAt) / 1000)) : 0;
    const latencies = ordered
        .filter((record) => !PENDING.has(record.status) && !record.rejudged && record.judgeAt && now - record.judgeAt <= 15 * 60_000)
        .map((record) => Math.max(0, (record.judgeAt! - record.submittedAt) / 1000));
    const systemErrors = ordered.filter((record) => SYSTEM_ERROR.has(record.status));
    const recentSystemErrors = systemErrors.filter((record) => now - (record.judgeAt || record.submittedAt) <= thresholds.systemErrorWindowSeconds * 1000);
    const describe = (record: MonitorRecord) => {
        const team = input.teamOf(record.uid);
        return {
            id: record.id, team: team?.name ?? `非参赛者 ${record.uid}`, problem: label.get(record.pid) ?? '?', lang: record.lang,
            status: statusLabels[record.status] ?? categories.find((category) => category.key === categoryOf(record.status))!.label,
            ageSeconds: Math.max(0, Math.floor((now - record.submittedAt) / 1000)),
        };
    };

    const perProblem = input.problems.map((problem) => {
        const own = ordered.filter((record) => record.pid === problem.pid);
        const counts: Record<string, number> = {};
        for (const record of own) counts[categoryOf(record.status)] = (counts[categoryOf(record.status)] || 0) + 1;
        const solvedTeams = new Set(own.filter((record) => record.status === 1).map((record) => input.teamOf(record.uid)?.id).filter(Boolean));
        return { label: problem.label, total: own.length, counts, solvedTeams: solvedTeams.size };
    });
    const languages = new Map<string, number>();
    for (const record of ordered) languages.set(record.lang, (languages.get(record.lang) || 0) + 1);

    // The last 60 minutes of the contest so far (or before it ends), one bucket per minute.
    const end = Math.min(now, input.endAt);
    const start = Math.max(input.beginAt, end - 60 * 60_000);
    const minutes = Math.max(1, Math.ceil((end - start) / 60_000));
    const timeline = Array.from({ length: minutes }, (_, index) => ({ minute: Math.floor((start - input.beginAt) / 60_000) + index, submitted: 0, accepted: 0 }));
    for (const record of ordered) {
        if (record.submittedAt < start || record.submittedAt > end) continue;
        const bucket = timeline[Math.min(minutes - 1, Math.floor((record.submittedAt - start) / 60_000))];
        bucket.submitted++;
        if (record.status === 1) bucket.accepted++;
    }

    const judges = input.judges
        .map((judge) => {
            const lastSeenSeconds = Math.max(0, Math.floor((now - judge.updateAt) / 1000));
            return { mid: judge.mid, online: lastSeenSeconds <= thresholds.judgeOfflineSeconds, lastSeenSeconds };
        })
        .filter((judge) => judge.lastSeenSeconds <= thresholds.judgeForgetSeconds)
        .sort((a, b) => Number(b.online) - Number(a.online) || a.mid.localeCompare(b.mid));

    const alerts: { level: 'error' | 'warning'; text: string }[] = [];
    if (!judges.some((judge) => judge.online)) alerts.push({ level: 'error', text: '没有在线的评测机' });
    for (const judge of judges.filter((item) => !item.online)) {
        alerts.push({ level: 'warning', text: `评测机 ${judge.mid} 已 ${Math.floor(judge.lastSeenSeconds / 60)} 分钟没有上报` });
    }
    if (oldestPendingSeconds > thresholds.pendingSeconds) {
        alerts.push({ level: 'warning', text: `有提交已等待评测 ${Math.floor(oldestPendingSeconds / 60)} 分 ${oldestPendingSeconds % 60} 秒` });
    }
    if (recentSystemErrors.length >= thresholds.systemErrors) {
        alerts.push({ level: 'error', text: `最近 ${thresholds.systemErrorWindowSeconds / 60} 分钟出现 ${recentSystemErrors.length} 次系统错误` });
    }

    return {
        now,
        summary: {
            total: ordered.length,
            accepted: ordered.filter((record) => record.status === 1).length,
            pending: pending.length,
            queueLength: input.queueLength,
            oldestPendingSeconds,
            systemErrors: systemErrors.length,
            judgedRecently: latencies.length,
            averageLatencySeconds: latencies.length ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10 : null,
            p95LatencySeconds: percentile(latencies, 95),
            judgesOnline: judges.filter((judge) => judge.online).length,
        },
        alerts,
        pending: pending.slice(0, 30).map(describe),
        systemErrors: systemErrors.slice(-10).reverse().map(describe),
        perProblem,
        languages: [...languages].map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count),
        timeline,
        judges,
        categories: categories.map(({ key, label }) => ({ key, label })),
    };
}

export type MonitorSnapshot = ReturnType<typeof monitorSnapshot>;
