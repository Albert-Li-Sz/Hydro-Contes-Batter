/**
 * Machine pressure for the inspection screen: this Hydro server sampled live, judge machines from
 * the reports they leave in Hydro's `status` collection (systeminformation mem() and currentLoad(),
 * written every 20 minutes by judge daemons and every 30 minutes by Hydro servers).
 */
import fs from 'node:fs';
import os from 'node:os';

export interface HostPressure {
    /** Percent busy across all cores since the previous sample (at least one second apart). */
    cpu: number | null;
    cores: number;
    /** 1, 5 and 15 minute load averages; null on Windows, which has none. */
    load: [number, number, number] | null;
    memoryTotal: number;
    memoryUsed: number;
    /** Percent of memory in use, not counting what the kernel can reclaim (page cache). */
    memoryRate: number;
    /** This Hydro process (one PM2 instance). */
    processRss: number;
    uptimeSeconds: number;
}

export interface JudgePressure {
    name: string;
    /** `local`: the hydrojudge addon on this server, so the server's numbers are its numbers. */
    kind: 'local' | 'remote' | 'builtin';
    cpu: number | null;
    memoryRate: number | null;
    memoryTotal: number | null;
    /** Seconds since the report the numbers come from; 0 for the local judge. */
    reportedSecondsAgo: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function cpuTimes() {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
        const { user, nice, sys, idle: free, irq } = cpu.times;
        idle += free;
        total += user + nice + sys + free + irq;
    }
    return { idle, total, at: Date.now() };
}
let previous = cpuTimes();
let lastCpu: number | null = null;

/** CPU busy share between this call and the previous sample; one second apart at least, so polls agree. */
function cpuUsage() {
    const now = cpuTimes();
    if (now.at - previous.at < 1000 || now.total <= previous.total) return lastCpu;
    lastCpu = round1(Math.min(100, Math.max(0, (1 - (now.idle - previous.idle) / (now.total - previous.total)) * 100)));
    previous = now;
    return lastCpu;
}

/** Linux counts reclaimable cache as used in os.freemem(); MemAvailable is what programs can still get. */
function memory() {
    const total = os.totalmem();
    try {
        const info = fs.readFileSync('/proc/meminfo', 'utf8');
        const available = /^MemAvailable:\s+(\d+) kB/m.exec(info)?.[1];
        if (available) return { total, used: Math.max(0, total - Number(available) * 1024) };
    } catch { /* not Linux */ }
    return { total, used: total - os.freemem() };
}

export function hostPressure(): HostPressure {
    const { total, used } = memory();
    const load = process.platform === 'win32' ? null : os.loadavg().map(round1) as [number, number, number];
    return {
        cpu: cpuUsage(),
        cores: os.cpus().length || 1,
        load,
        memoryTotal: total,
        memoryUsed: used,
        memoryRate: total ? round1((used / total) * 100) : 0,
        processRss: process.memoryUsage().rss,
        uptimeSeconds: Math.floor(os.uptime()),
    };
}

export interface StatusReport {
    mid?: unknown;
    type?: unknown;
    updateAt?: unknown;
    memory?: { total?: unknown; active?: unknown; used?: unknown; available?: unknown };
    load?: { currentLoad?: unknown };
}

const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
/** Machines that stopped reporting this long ago are retired, as on the judge monitor. */
const FORGET_SECONDS = 6 * 3600;

/**
 * Judge machines' last reported CPU and memory. With the hydrojudge addon loaded here, this server
 * judges itself (`local`), and other servers' entries are left out as on the judge monitor.
 */
export function judgePressure(reports: StatusReport[], now: number, local: HostPressure | null): JudgePressure[] {
    const result: JudgePressure[] = [];
    if (local) {
        result.push({ name: '内置评测（本机）', kind: 'local', cpu: local.cpu, memoryRate: local.memoryRate, memoryTotal: local.memoryTotal, reportedSecondsAgo: 0 });
    }
    for (const report of reports) {
        if (typeof report.mid !== 'string' && typeof report.mid !== 'number') continue;
        if (report.type !== 'judge' && (report.type !== 'server' || local)) continue;
        const updated = new Date(report.updateAt as string).getTime();
        const ago = Number.isFinite(updated) ? Math.max(0, Math.floor((now - updated) / 1000)) : Infinity;
        if (ago > FORGET_SECONDS) continue;
        const total = number(report.memory?.total);
        // systeminformation: `active` excludes buffers and cache; `available` is the same from the other side.
        const active = number(report.memory?.active) ?? (total !== null && number(report.memory?.available) !== null ? total - number(report.memory?.available)! : null);
        const cpu = number(report.load?.currentLoad);
        result.push({
            name: report.type === 'judge' ? String(report.mid) : `内置评测 ${report.mid}`,
            kind: report.type === 'judge' ? 'remote' : 'builtin',
            cpu: cpu === null ? null : round1(cpu),
            memoryRate: total && active !== null ? round1((active / total) * 100) : null,
            memoryTotal: total,
            reportedSecondsAgo: ago,
        });
    }
    // The screen lists as many as fit: this server's judge first, then the busiest machines.
    const pressure = (judge: JudgePressure) => Math.max(judge.cpu ?? 0, judge.memoryRate ?? 0);
    return result.sort((a, b) => (a.kind === 'local' ? -1 : b.kind === 'local' ? 1 : pressure(b) - pressure(a) || a.name.localeCompare(b.name)));
}
