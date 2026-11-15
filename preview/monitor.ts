import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Environment } from 'nunjucks';
import type { BoardData } from '../lib/board';
import { hostPressure, reportMetrics } from '../lib/host';
import { JudgeTracker, mergeJudges, type TaskInfo } from '../lib/judge-tracker';
import { type MonitorMachine, monitorSnapshot, type MonitorRecord } from '../lib/monitor';
import { resolverCodeBase } from '../lib/resolver-data';
import { toScriptJson } from '../lib/settings';

const statusCodes: Record<string, number> = {
    CORRECT: 1, WRONG_ANSWER: 2, TIME_LIMIT_EXCEEDED: 3, MEMORY_LIMIT_EXCEEDED: 4, RUNTIME_ERROR: 6, COMPILATION_ERROR: 7,
};
const gb = 1024 ** 3;

/**
 * Local preview of the judge monitor (lib/monitor-routes.ts): the same JudgeTracker fed by a
 * simulated contest, three judge daemons, the built-in judge, a daemon that dropped and one that
 * only reports. The simulation catches up with the clock on every poll.
 */
export function createMonitorPreview(env: Environment, version: string, demo: () => BoardData) {
    const codeBase = resolverCodeBase(version);
    const base = '/contest/demo';
    const begin = Date.now() - 95 * 60_000;
    const data = demo();
    const verdicts = Object.keys(statusCodes);
    const languages = ['cc.cc17', 'py.py3', 'java'];
    // History over the last 90 minutes, then a few waiting ones and two system errors.
    const records: MonitorRecord[] = Array.from({ length: 140 }, (_, index) => {
        const team = data.teams[index % data.teams.length];
        const submittedAt = begin + index * 37_000 + (index % 5) * 4_000;
        return {
            id: `65f${(index + 4096).toString(16).padStart(21, '0')}`, submittedAt, status: statusCodes[verdicts[(index * 7) % verdicts.length]],
            uid: Number(team.team_id), pid: index % data.contest.problem_quantity, lang: languages[index % 3], judgeAt: submittedAt + 8_000 + (index % 9) * 2_000,
        };
    });

    let clock = Date.now() - 32 * 60_000;
    const tracker = new JudgeTracker('hydro-main', () => clock);
    const daemons = [
        { id: 'd1', uname: 'judge', ip: '10.0.0.21', mid: 'mid-a', concurrency: 4, speed: 1 },
        { id: 'd2', uname: 'judge', ip: '10.0.0.22', mid: 'mid-b', concurrency: 4, speed: 1.6 },
        { id: 'd3', uname: 'judge2', ip: '10.0.0.23', mid: 'mid-c', concurrency: 2, speed: 1.2 },
    ];
    for (const daemon of daemons) {
        tracker.connect(daemon.id, { uname: daemon.uname, ip: daemon.ip });
        tracker.message(daemon.id, { key: 'config', concurrency: daemon.concurrency });
        tracker.message(daemon.id, { key: 'status', info: { mid: daemon.mid } });
    }
    tracker.builtin();
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let serial = 0;
    const plans = new Map<string, { judge: string; doneAt: number; status: number; cases: number; total: number }>();
    const newTask = (): TaskInfo => {
        const own = random() < 0.75;
        const team = data.teams[Math.floor(random() * data.teams.length)];
        return {
            rid: `66a${(serial++).toString(16).padStart(21, '0')}`, domainId: own ? 'system' : 'training', uid: Number(team.team_id),
            pid: Math.floor(random() * data.contest.problem_quantity), lang: languages[Math.floor(random() * 3)], contest: own ? 'demo' : null,
        };
    };
    const result = () => { const r = random(); return r < 0.45 ? 1 : r < 0.7 ? 2 : r < 0.8 ? 3 : r < 0.86 ? 6 : r < 0.93 ? 7 : r < 0.99 ? 4 : 8; };
    let builtinActive: (TaskInfo & { doneAt: number; status: number })[] = [];
    let dropped = false;
    function step(to: number) {
        for (; clock < to; clock += 2000) {
            // judge-c drops 4 minutes ago.
            if (!dropped && clock > to - 4 * 60_000 && to - clock < 4 * 60_000) { tracker.disconnect('d3'); dropped = true; }
            for (const daemon of daemons) {
                if (daemon.id === 'd3' && dropped) continue;
                const judge = tracker.judges.get(daemon.id)!;
                for (const task of [...judge.active]) {
                    const plan = plans.get(task.rid)!;
                    if (clock >= plan.doneAt) {
                        tracker.message(daemon.id, { key: 'end', rid: task.rid, status: plan.status, time: Math.floor(random() * 900), memory: Math.floor(4000 + random() * 60000) });
                        plans.delete(task.rid);
                    } else if (plan.cases < plan.total) {
                        plan.cases++;
                        tracker.message(daemon.id, { key: 'next', rid: task.rid, status: plan.cases === 1 ? 21 : 20, case: { status: 1 }, progress: (plan.cases / plan.total) * 100 });
                    }
                }
                if (judge.active.length < daemon.concurrency && random() < 0.55) {
                    const task = newTask();
                    tracker.taskStart(daemon.id, task);
                    plans.set(task.rid, { judge: daemon.id, doneAt: clock + (2 + random() * 9) * 1000 * daemon.speed, status: result(), cases: 0, total: 5 + Math.floor(random() * 15) });
                }
            }
            for (const task of builtinActive.filter((item) => clock >= item.doneAt)) tracker.builtinFinish(task, { status: task.status, time: 120, memory: 9000 });
            builtinActive = builtinActive.filter((item) => clock < item.doneAt);
            if (builtinActive.length < 2 && random() < 0.2) {
                const task = { ...newTask(), doneAt: clock + (3 + random() * 6) * 1000, status: result() };
                builtinActive.push(task);
                tracker.builtinChange(task, 20, 3, 40);
            }
        }
    }

    return async (_request: IncomingMessage, response: ServerResponse, url: URL) => {
        if (url.pathname === `${base}/monitor`) {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(env.render('xcpcio_monitor.html', {
                codeBase, tdoc: { title: data.contest.contest_name },
                runtimeJson: toScriptJson({ dataUrl: `${base}/monitor/data`, contestUrl: base, title: data.contest.contest_name, refreshMs: 3000 }),
            }));
            return true;
        }
        if (url.pathname !== `${base}/monitor/data`) return false;
        const now = Date.now();
        step(now);
        const live: MonitorRecord[] = [
            { id: '65f00000000000000000aa01', submittedAt: now - 250_000, status: 0, uid: 3, pid: 1, lang: 'cc.cc17' },
            { id: '65f00000000000000000aa02', submittedAt: now - 40_000, status: 20, uid: 5, pid: 2, lang: 'py.py3' },
            { id: '65f00000000000000000aa03', submittedAt: now - 200_000, status: 8, uid: 7, pid: 0, lang: 'java', judgeAt: now - 190_000 },
        ];
        const names = new Map(data.teams.map((team) => [Number(team.team_id), { id: team.team_id, name: team.name }]));
        const host = hostPressure();
        const reports = {
            'mid-a': { mid: 'mid-a', updateAt: new Date(now - 6 * 60_000), memory: { total: 16 * gb, active: 5.1 * gb }, load: { currentLoad: 58.2 }, CpuTemp: { main: 61 }, cpu: { manufacturer: 'Intel', brand: 'Xeon E-2288G', cores: 16 }, osinfo: { distro: 'Ubuntu', release: '24.04', hostname: 'judge-a' }, compilers: { cc: 1, py: 1, java: 1 } },
            'mid-b': { mid: 'mid-b', updateAt: new Date(now - 13 * 60_000), memory: { total: 8 * gb, active: 7.5 * gb }, load: { currentLoad: 96.4 }, CpuTemp: { main: 83 }, cpu: { manufacturer: 'AMD', brand: 'Ryzen 7 5800X', cores: 16 }, osinfo: { distro: 'Debian', release: '12', hostname: 'judge-b' }, compilers: { cc: 1, py: 1 } },
            'mid-c': { mid: 'mid-c', updateAt: new Date(now - 9 * 60_000), memory: { total: 8 * gb, active: 2 * gb }, load: { currentLoad: 22 }, cpu: { manufacturer: 'Intel', brand: 'Core i5-12400', cores: 12 }, osinfo: { distro: 'Ubuntu', release: '22.04', hostname: 'judge-c' } },
            'mid-d': { mid: 'mid-d', updateAt: new Date(now - 18 * 60_000), memory: { total: 4 * gb, active: 1 * gb }, load: { currentLoad: 3 }, osinfo: { hostname: 'judge-old' } },
        } as const;
        const judges = mergeJudges([{ host: 'hydro-main', judges: tracker.snapshot() }]);
        const machines: MonitorMachine[] = judges.map((judge) => (judge.kind === 'builtin'
            ? {
                key: judge.id, name: '内置评测（hydro-main）', kind: 'builtin', tracked: judge,
                metrics: { cpu: host.cpu, memoryRate: host.memoryRate, memoryTotal: host.memoryTotal, temperature: null, cores: host.cores, model: host.model, os: host.os, compilers: null, reportedAt: null },
            }
            : { key: judge.id, name: reports[judge.mid as 'mid-a'].osinfo.hostname, kind: 'remote', tracked: judge, metrics: reportMetrics(reports[judge.mid as 'mid-a']) }));
        machines.push({ key: 'report:mid-d', name: 'judge-old', kind: 'remote', tracked: null, metrics: reportMetrics(reports['mid-d']) });
        const snapshot = monitorSnapshot({
            now, contest: { domainId: 'system', id: 'demo' }, records: [...records, ...live], queueLength: 3, machines,
            problems: (data.contest.problem_id as string[]).map((label, pid) => ({ pid, label })),
            teamOf: (uid) => names.get(uid) ?? null,
        });
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(snapshot));
        return true;
    };
}
