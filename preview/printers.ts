import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocket, WebSocketServer } from 'ws';
import type { Environment } from 'nunjucks';
import type { BoardData } from '../lib/board';
import {
    CLAIM_TIMEOUT_MS, connectionCode, hashToken, headerFields, languageOfFile, lineCount, MAX_ATTEMPTS, newPrintToken, normalizePrinterPreference,
    normalizePrintSettings, normalizeServerInput, ONLINE_MS, PrintError, type PrinterPreference, type PrintServerInput, seatOf, serverTakes,
    tokenMatches,
} from '../lib/print';
import { printJob } from '../lib/print-render';
import { resolverCodeBase } from '../lib/resolver-data';
import { toScriptJson } from '../lib/settings';
import { previewAdminPassword } from './manage';

interface Server extends PrintServerInput {
    id: string; tokenHash: string; lastSeen: number | null; client: Record<string, string> | null;
    printers: { name: string; status: string; queue: number; message: string; isDefault: boolean; virtual?: boolean }[];
    preferences: Record<string, PrinterPreference>; stats: { printed: number; failed: number };
    tests: { id: string; printer: string }[]; lastTest: Record<string, unknown> | null;
}
interface Task { id: string; contest: string; owner: number; title: string; content: string; status: string; server?: string; printer?: string; claimedAt?: number; attempts: number; error?: string; time: Date }

const samples = [
    ['a.cpp', '#include <bits/stdc++.h>\nusing namespace std;\n\n// 二分答案\nint main() {\n    long long n, k;\n    cin >> n >> k;\n    long long lo = 0, hi = 1e18;\n    while (lo < hi) {\n        long long mid = (lo + hi) / 2;\n        if (mid * mid >= n) hi = mid; else lo = mid + 1;\n    }\n    printf("%lld\\n", lo); /* 输出答案 */\n    return 0;\n}\n'],
    ['bfs.py', 'from collections import deque\n\n\ndef bfs(graph, start):\n    """最短路"""\n    dist = {start: 0}\n    queue = deque([start])\n    while queue:\n        u = queue.popleft()\n        for v in graph[u]:\n            if v not in dist:  # 第一次访问\n                dist[v] = dist[u] + 1\n                queue.append(v)\n    return dist\n'],
    ['Main.java', 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        System.out.println(n * 2); // 输出两倍\n    }\n}\n'],
];

/**
 * Local preview of 打印服务器管理 and the print client protocol (lib/print-routes.ts), in memory:
 * the demo contest's teams send a print request every 20 seconds, so a real client can be tried.
 */
export function createPrintersPreview(env: Environment, version: string, demo: () => BoardData) {
    const codeBase = resolverCodeBase(version);
    const data = demo();
    // Three contests: the demo final and warm-up accept print requests, the trial does not.
    const contests = [
        { key: 'system/6740a0000000000000000001', domainId: 'system', title: data.contest.contest_name, allowPrint: true, beginAt: new Date(data.contest.start_time * 1000) },
        { key: 'system/6740a0000000000000000002', domainId: 'system', title: '2026 校赛热身赛', allowPrint: true, beginAt: new Date(data.contest.start_time * 1000 - 86400_000) },
        { key: 'training/6740a0000000000000000003', domainId: 'training', title: '新生选拔赛', allowPrint: false, beginAt: new Date(data.contest.start_time * 1000 - 7 * 86400_000) },
    ];
    const contestKey = contests[0].key;
    let settings = normalizePrintSettings({});
    // Seats as onsite-toolkit imports them: the `seat` field of each team account.
    const onsiteSeats = new Map<number, string>([[1, 'A-01'], [2, 'A-02'], [3, 'B-01'], [4, 'B-02'], [5, 'A-03'], [6, 'B-03'], [7, 'A-04']]);
    const servers: Server[] = [];
    const tasks: Task[] = [];
    // The management page's socket (lib/print-routes.ts PrintersSocketHandler): told when anything changes.
    const sockets = new Set<WebSocket>();
    const changed = () => { for (const ws of sockets) ws.send(JSON.stringify({ type: 'changed' })); };
    let counter = 0;
    const addTask = () => {
        const team = data.teams[counter % data.teams.length];
        const [title, content] = samples[counter % samples.length];
        // Every third request comes from the warm-up contest.
        const contest = counter % 3 === 2 ? contests[1].key : contestKey;
        tasks.push({ id: `6742a${String(++counter).padStart(19, '0')}`, contest, owner: Number(team.team_id), title, content, status: 'pending', attempts: 0, time: new Date() });
        changed();
    };
    for (let index = 0; index < 4; index++) addTask();
    const timer = setInterval(addTask, 20_000);
    timer.unref();

    const who = (uid: number) => {
        const team = data.teams.find((candidate) => Number(candidate.team_id) === uid);
        const uname = `user${uid}`;
        return { name: team?.name || uname, school: team?.organization || '', members: [], uname, unofficial: !!team?.group.includes('unofficial'),
            seat: seatOf(onsiteSeats, uid) };
    };
    const sheet = (task: Task) => {
        const person = who(task.owner);
        return printJob({ id: task.id, team: person.name, school: person.school, members: person.members, account: person.uname, seat: person.seat,
            unofficial: person.unofficial, problem: task.title, language: languageOfFile(task.title), time: task.time, lines: lineCount(task.content), code: task.content },
        settings, contests.find((contest) => contest.key === task.contest)?.title || data.contest.contest_name);
    };
    const release = (now: number) => {
        for (const task of tasks) if (task.status === 'printing' && task.claimedAt && now - task.claimedAt > CLAIM_TIMEOUT_MS) Object.assign(task, { status: 'pending', server: undefined });
    };
    const find = (id: unknown) => {
        const server = servers.find((candidate) => candidate.id === id);
        if (!server) throw new PrintError('打印服务器不存在', 404);
        return server;
    };

    async function admin(name: string, body: any, origin: string) {
        switch (name) {
        case 'create': {
            const input = normalizeServerInput(body);
            const token = newPrintToken();
            const server: Server = { ...input, id: `6742b${String(servers.length + 1).padStart(19, '0')}`, tokenHash: hashToken(token), lastSeen: null, client: null,
                printers: [], preferences: {}, stats: { printed: 0, failed: 0 }, tests: [], lastTest: null };
            servers.push(server);
            return { id: server.id, code: connectionCode(body.origin || origin, server.id, token) };
        }
        case 'update': { const server = find(body.id); Object.assign(server, normalizeServerInput(body.server, server)); return { ok: true }; }
        case 'regenerate': { const server = find(body.id); const token = newPrintToken(); server.tokenHash = hashToken(token); return { code: connectionCode(body.origin || origin, server.id, token) }; }
        case 'delete': {
            const server = find(body.id);
            if (body.password !== previewAdminPassword) throw new PrintError('管理员密码错误', 403);
            servers.splice(servers.indexOf(server), 1);
            for (const task of tasks) if (task.server === server.id && task.status === 'printing') Object.assign(task, { status: 'pending', server: undefined });
            return { ok: true };
        }
        case 'printer': { const server = find(body.id); server.preferences[String(body.printer)] = normalizePrinterPreference(body.preference); return { preference: server.preferences[String(body.printer)] }; }
        case 'test': { const server = find(body.id); server.tests.push({ id: `test-${Date.now()}`, printer: String(body.printer || '') }); return { ok: true }; }
        case 'settings': settings = normalizePrintSettings(body.settings, settings); return { settings };
        case 'requeue': {
            let updated = 0;
            const ids = body.tasks || [];
            for (const task of tasks) if (ids.includes(task.id) && (task.status === 'printed' || task.status === 'failed')) { Object.assign(task, { status: 'pending', server: undefined, attempts: 0, error: undefined }); updated++; }
            return { updated, skipped: ids.length - updated };
        }
        default: throw new PrintError('未知操作');
        }
    }

    function client(action: string, server: Server, body: any) {
        const now = Date.now();
        server.lastSeen = now;
        if (action === 'heartbeat') {
            server.client = { version: String(body.version || ''), host: String(body.host || ''), os: String(body.os || ''), ip: '127.0.0.1' };
            server.printers = (body.printers || []).slice(0, 50);
            return { name: server.name, enabled: server.enabled, pollMs: 3000,
                preferences: Object.fromEntries(server.printers.map((printer) => [printer.name, server.preferences[printer.name] ?? { enabled: !printer.virtual, weight: 1 }])) };
        }
        if (action === 'next') {
            if (!server.enabled) return { jobs: [] };
            release(now);
            const slots = Math.max(1, Math.min(10, Number(body.slots) || 1));
            const jobs: unknown[] = server.tests.splice(0, slots).map((test) => ({ ...sheet({ id: test.id, contest: contestKey, owner: 1, title: 'test.cpp', content: samples[0][1], status: '', attempts: 0, time: new Date() }), printer: test.printer, title: `测试页 · ${server.name}` }));
            const others = servers.filter((candidate) => candidate.enabled && candidate.lastSeen && now - candidate.lastSeen < ONLINE_MS);
            for (const task of tasks) {
                if (jobs.length >= slots) break;
                if (task.status !== 'pending' || !serverTakes(server, { contest: task.contest, seat: who(task.owner).seat }, others)) continue;
                Object.assign(task, { status: 'printing', server: server.id, claimedAt: now });
                jobs.push(sheet(task));
            }
            return { jobs };
        }
        if (action === 'report') {
            if (String(body.id).startsWith('test-')) { server.lastTest = { at: new Date(), printer: body.printer, status: body.status, message: body.message || '' }; return { ok: true }; }
            const task = tasks.find((candidate) => candidate.id === body.id && candidate.server === server.id && candidate.status === 'printing');
            if (!task) throw new PrintError('打印请求不存在或已交给其他打印服务器', 404);
            if (body.status === 'released') Object.assign(task, { status: 'pending', server: undefined });
            else if (body.status === 'printed') { Object.assign(task, { status: 'printed', printer: body.printer }); server.stats.printed++; } else {
                task.attempts++;
                Object.assign(task, task.attempts < MAX_ATTEMPTS ? { status: 'pending', server: undefined, error: body.message, printer: body.printer } : { status: 'failed', error: body.message, printer: body.printer });
                server.stats.failed++;
            }
            return { ok: true };
        }
        throw new PrintError('未知操作', 404);
    }

    function overview() {
        const now = Date.now();
        release(now);
        const queue: Record<string, number> = {};
        for (const task of tasks) queue[task.status] = (queue[task.status] || 0) + 1;
        return {
            settings, clients: [], queue,
            contests: contests.map((contest) => ({ ...contest, endAt: contest.beginAt, rule: 'acm' })),
            servers: servers.map((server) => {
                const online = !!server.lastSeen && now - server.lastSeen < ONLINE_MS;
                return {
                    id: server.id, name: server.name, note: server.note, enabled: server.enabled, contests: server.contests, seatPrefixes: server.seatPrefixes,
                    online, lastSeen: server.lastSeen ? new Date(server.lastSeen) : null, client: server.client, stats: server.stats, lastTest: server.lastTest, testsWaiting: server.tests.length,
                    printers: server.printers.map((printer) => ({
                        ...printer, status: online ? printer.status : 'offline', preference: server.preferences[printer.name] ?? { enabled: !printer.virtual, weight: 1 },
                        printed: tasks.filter((task) => task.server === server.id && task.printer === printer.name && task.status === 'printed').length,
                    })),
                };
            }),
            recent: [...tasks].reverse().slice(0, 50).map((task) => ({
                id: task.id, contest: contests.find((contest) => contest.key === task.contest)?.title || task.contest, title: task.title, status: task.status, team: who(task.owner).name, seat: who(task.owner).seat, time: task.time,
                server: servers.find((server) => server.id === task.server)?.name || '', printer: task.printer || '', attempts: task.attempts, error: task.error || '',
            })),
        };
    }

    const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer, server: WebSocketServer) => {
        if (new URL(request.url || '/', 'http://localhost').pathname !== '/manage/xcpcio-printers/ws') return false;
        server.handleUpgrade(request, socket, head, (ws) => {
            sockets.add(ws);
            ws.on('close', () => sockets.delete(ws));
        });
        return true;
    };
    return Object.assign(async (request: IncomingMessage, response: ServerResponse, url: URL) => {
        const json = (value: unknown, status = 200) => response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
        const api = /^\/xcpcio-print\/([a-f\d]{24})\/(heartbeat|next|report)$/.exec(url.pathname);
        if (!api && !url.pathname.startsWith('/manage/xcpcio-printers')) return false;
        try {
            let text = '';
            if (request.method === 'POST') for await (const chunk of request) text += chunk;
            const body = text ? JSON.parse(text) : {};
            if (api) {
                const token = /^Bearer\s+(\S+)$/i.exec(String(request.headers.authorization || ''))?.[1] || '';
                const server = servers.find((candidate) => candidate.id === api[1]);
                if (!server || !token || !tokenMatches(token, server.tokenHash)) throw new PrintError('连接信息无效或已重新生成，请在“打印服务器管理”中复制新的连接信息', 401);
                json(client(api[2], server, body));
                changed();
                return true;
            }
            if (url.pathname === '/manage/xcpcio-printers/data') { json(overview()); return true; }
            if (url.pathname !== '/manage/xcpcio-printers') return false;
            if (request.method === 'POST') { json(await admin(body.operation, JSON.parse(body.payload || '{}'), `http://${request.headers.host}`)); changed(); return true; }
            const menu = [['控制面板', '#'], ['脚本管理', '#'], ['导入用户', '#'], ['用户配置', '/manage/xcpcio-users'], ['用户权限', '#'], ['系统设置', '#'], ['配置管理', '#'],
                ['评测机控制', '/manage/xcpcio-judges'], ['打印服务器管理', '/manage/xcpcio-printers'], ['批量重测', '/manage/xcpcio-rejudge']];
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(env.render('xcpcio_manage_printers.html', {
                codeBase, tdoc: { title: '控制面板' }, manageMenu: menu.map(([label, href]) => ({ label, href, active: href === url.pathname })),
                runtimeJson: toScriptJson({ base: url.pathname, dataUrl: `${url.pathname}/data`, socket: `${url.pathname}/ws`, headerFields }),
            }));
        } catch (error) {
            json({ error: error instanceof Error ? error.message : 'Invalid request' }, error instanceof PrintError ? error.status : 400);
        }
        return true;
    }, { upgrade });
}
