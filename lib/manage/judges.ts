/**
 * Judge machine control: the dispatch rules an administrator sets per judge account, and how they
 * narrow what each daemon takes from Hydro's task queue. Pure; lib/manage-routes.ts applies them.
 *
 * Hydro's queue is pulled: every connected daemon takes the highest-priority task its query
 * matches, up to its concurrency. Balancing is therefore done by concurrency caps (a machine with
 * a higher cap takes a larger share), language pools and separating fresh submissions from rejudges.
 */
import { randomBytes } from 'node:crypto';
import { type MonitorMachine, monitorSnapshot } from '../monitor';
import { ManageError } from './users';

export type JudgeScope = 'all' | 'new' | 'rejudge';
export const judgeScopes: [JudgeScope, string][] = [
    ['all', '全部任务'],
    ['new', '只评测新提交（不接重测）'],
    ['rejudge', '只评测重测任务'],
];

export interface JudgeRule {
    /** Paused judges keep their connection and finish what they hold, but take no new tasks. */
    enabled: boolean;
    /** Upper bound on the daemon's own concurrency; null keeps the daemon's value. */
    concurrency: number | null;
    /** Only these languages (Hydro language keys); empty means every language the daemon accepts. */
    langs: string[];
    scope: JudgeScope;
    note: string;
}

export const defaultJudgeRule = (): JudgeRule => ({ enabled: true, concurrency: null, langs: [], scope: 'all', note: '' });

export function normalizeJudgeRule(input: unknown): JudgeRule {
    if (!input || typeof input !== 'object') throw new ManageError('无效的评测机设置');
    const raw = input as Record<string, unknown>;
    const rule = defaultJudgeRule();
    rule.enabled = raw.enabled !== false;
    if (raw.concurrency !== null && raw.concurrency !== undefined && raw.concurrency !== '') {
        const value = Number(raw.concurrency);
        if (!Number.isSafeInteger(value) || value < 1 || value > 256) throw new ManageError('并发上限需为 1 至 256 的整数');
        rule.concurrency = value;
    }
    const langs = Array.isArray(raw.langs) ? raw.langs : typeof raw.langs === 'string' ? raw.langs.split(/[\s,，]+/) : [];
    rule.langs = [...new Set(langs.map((lang) => String(lang).trim()).filter(Boolean))];
    if (rule.langs.some((lang) => !/^[\w.+-]{1,64}$/.test(lang))) throw new ManageError('语言代码无效');
    if (judgeScopes.some(([scope]) => scope === raw.scope)) rule.scope = raw.scope as JudgeScope;
    rule.note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 200) : '';
    return rule;
}

/** What the daemon asked for in its `config` message. */
export interface DaemonConfig {
    concurrency: number | null;
    langs: string[] | null;
    prio: number | null;
    types: string[] | null;
}

export const emptyDaemonConfig = (): DaemonConfig => ({ concurrency: null, langs: null, prio: null, types: null });

/** Records the fields Hydro itself accepts from a daemon `config` message. */
export function readDaemonConfig(current: DaemonConfig, msg: Record<string, unknown>): DaemonConfig {
    const next = { ...current };
    const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string') ? value as string[] : null;
    if (Number.isSafeInteger(msg.prio)) next.prio = msg.prio as number;
    if (Number.isSafeInteger(msg.concurrency) && (msg.concurrency as number) > 0) next.concurrency = msg.concurrency as number;
    if (strings(msg.lang)) next.langs = strings(msg.lang);
    if (strings(msg.type)) next.types = strings(msg.type);
    return next;
}

/**
 * The task query and concurrency the daemon's consumer should use: Hydro's own query for what the
 * daemon asked, narrowed by the administrator's rule. A language pool that shares nothing with the
 * daemon's languages matches no task, rather than silently widening.
 */
export function dispatchFor(rule: JudgeRule, daemon: DaemonConfig) {
    const query: Record<string, unknown> = { type: { $in: daemon.types ?? ['judge', 'generate'] } };
    if (daemon.prio !== null) query.priority = { $gt: daemon.prio };
    let langs = daemon.langs;
    if (rule.langs.length) langs = langs ? langs.filter((lang) => rule.langs.includes(lang)) : rule.langs;
    if (langs) query.lang = { $in: langs };
    if (rule.scope === 'new') query['meta.rejudge'] = { $ne: true };
    if (rule.scope === 'rejudge') query['meta.rejudge'] = true;
    const own = daemon.concurrency ?? 1;
    const concurrency = rule.enabled ? Math.min(own, rule.concurrency ?? own) : 0;
    return { query, concurrency };
}

/** Readable, unambiguous password for a judge account; each copy of its config gets a new one. */
export function judgePassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(24);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

const yamlString = (value: string) => JSON.stringify(value);

/** Hydrojudge's ~/.hydro/judge.yaml for one Hydro server. */
export function judgeConfig({ serverUrl, uname, password, host = 'hydro' }: { serverUrl: string; uname: string; password: string; host?: string }) {
    const url = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
    return [
        'hosts:',
        `  ${host}:`,
        '    type: hydro',
        `    server_url: ${yamlString(url)}`,
        `    uname: ${yamlString(uname)}`,
        `    password: ${yamlString(password)}`,
        '    detail: true',
        '',
    ].join('\n');
}

export function checkJudgeName(value: unknown) {
    if (typeof value !== 'string' || !/^[A-Za-z][\w-]{2,30}$/.test(value.trim())) {
        throw new ManageError('评测机账号需以字母开头，由 3 至 31 位字母、数字、下划线或连字符组成');
    }
    return value.trim();
}

/**
 * Health of every judge machine for the control page: the built-in judge (hydrojudge running inside
 * Hydro) and each daemon, live or known only from its reports, with the monitor's machine alerts.
 */
export function judgeHealth(now: number, machines: MonitorMachine[], queueLength: number) {
    const snapshot = monitorSnapshot({ now, contest: { domainId: '', id: '' }, records: [], machines, queueLength, problems: [], teamOf: () => null });
    return {
        alerts: snapshot.alerts,
        machines: snapshot.machines.map((machine) => ({
            key: machine.key, name: machine.name, kind: machine.kind, state: machine.state, online: machine.online, reportOnly: machine.reportOnly,
            account: machine.account, ip: machine.ip, connectedSeconds: machine.connectedSeconds, disconnectedSeconds: machine.disconnectedSeconds,
            concurrency: machine.concurrency, langs: machine.langs, activeCount: machine.activeCount, judged5: machine.judged5, judged15: machine.judged15,
            systemErrors15: machine.systemErrors15, averageSeconds: machine.averageSeconds, lastFinishedSeconds: machine.lastFinishedSeconds,
            totalJudged: machine.totalJudged, metrics: machine.metrics,
        })),
    };
}

export type JudgeHealth = ReturnType<typeof judgeHealth>;
