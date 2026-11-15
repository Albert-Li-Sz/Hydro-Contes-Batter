import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Environment } from 'nunjucks';
import type { BoardData } from '../lib/board';
import { monitorSnapshot, type MonitorRecord } from '../lib/monitor';
import { resolverCodeBase } from '../lib/resolver-data';
import { toScriptJson } from '../lib/settings';

const statusCodes: Record<string, number> = {
    CORRECT: 1, WRONG_ANSWER: 2, TIME_LIMIT_EXCEEDED: 3, MEMORY_LIMIT_EXCEEDED: 4, RUNTIME_ERROR: 6, COMPILATION_ERROR: 7,
};

/** Local preview of the judge monitor (lib/monitor-routes.ts) on simulated judging. */
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
    return async (_request: IncomingMessage, response: ServerResponse, url: URL) => {
        if (url.pathname === `${base}/monitor`) {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(env.render('xcpcio_monitor.html', {
                codeBase, tdoc: { title: data.contest.contest_name },
                runtimeJson: toScriptJson({ dataUrl: `${base}/monitor/data`, contestUrl: base, title: data.contest.contest_name, refreshMs: 5000 }),
            }));
            return true;
        }
        if (url.pathname !== `${base}/monitor/data`) return false;
        const now = Date.now();
        const live: MonitorRecord[] = [
            { id: '65f00000000000000000aa01', submittedAt: now - 250_000, status: 0, uid: 3, pid: 1, lang: 'cc.cc17' },
            { id: '65f00000000000000000aa02', submittedAt: now - 40_000, status: 20, uid: 5, pid: 2, lang: 'py.py3' },
            { id: '65f00000000000000000aa03', submittedAt: now - 200_000, status: 8, uid: 7, pid: 0, lang: 'java', judgeAt: now - 190_000 },
            { id: '65f00000000000000000aa04', submittedAt: now - 120_000, status: 8, uid: 1, pid: 0, lang: 'cc.cc17', judgeAt: now - 110_000 },
        ];
        const names = new Map(data.teams.map((team) => [Number(team.team_id), { id: team.team_id, name: team.name }]));
        const snapshot = monitorSnapshot({
            now, beginAt: begin, endAt: begin + 300 * 60_000, records: [...records, ...live], queueLength: 3,
            judges: [
                { mid: '内置评测机（本机 Hydro）', updateAt: now, kind: 'local' },
                { mid: 'judge-01', updateAt: now - 12 * 60_000, kind: 'remote' },
                { mid: 'judge-02', updateAt: now - 40 * 60_000, kind: 'remote' },
            ],
            problems: (data.contest.problem_id as string[]).map((label, pid) => ({ pid, label })),
            teamOf: (uid) => names.get(uid) ?? null,
        });
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(snapshot));
        return true;
    };
}
