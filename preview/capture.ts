import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Environment } from 'nunjucks';
import type { WebSocket, WebSocketServer } from 'ws';
import type { BoardData } from '../lib/board';
import {
    CaptureError, type CaptureDevice, captureMedias, captureProfile, CaptureRelay, captureSecretMatches, type CaptureSettings, type CaptureStream,
    captureStreams, defaultCaptureSettings, isCaptureOnline, newCaptureSecret, normalizeCaptureSettings, normalizeDeviceInput, streamAllowed,
} from '../lib/live/capture';
import { toScriptJson } from '../lib/settings';

/**
 * 画面采集 in the local preview, mirroring lib/live/capture-routes.ts without Hydro or MongoDB.
 * Every preview visitor counts as contest staff; the overlay link counts as the OBS overlay.
 * Open a device's capture link in another browser tab to try the whole path on one computer.
 */
export function createCapturePreview(env: Environment, options: {
    codeBase: string;
    base: string;
    contest: { title: string; endAt: Date };
    /** The demo teams and the seats they sit at. */
    teams: () => { uid: number; name: string; seat: string }[];
    overlayToken: () => string;
}) {
    const { base, codeBase, contest } = options;
    const contestKey = 'demo';
    const devices = new Map<string, CaptureDevice>();
    let settings: CaptureSettings = defaultCaptureSettings();
    // One process: the bus has nobody to reach.
    const relay = new CaptureRelay(() => {});
    let counter = 0;
    const captureUrl = (device: CaptureDevice) => `${base}/live-capture/${device._id}/${device.secret}`;

    function create(input: { seat: string; name: string; teamUid: number | null }) {
        const id = (0x6800000000 + counter++).toString(16).padStart(24, '0');
        devices.set(id, { _id: id, contestKey, ...input, secret: newCaptureSecret(), createdAt: new Date(), lastSeen: null, connection: null, streams: [], client: null });
    }

    function medias(data: BoardData) {
        if (!settings.enabled || !devices.size) return {};
        const seats = new Map(options.teams().map((team) => [String(team.uid), team.seat]));
        const teams = data.teams.map((team) => ({ teamId: team.team_id, uid: Number(team.team_id), seat: seats.get(team.team_id) || '' }));
        return captureMedias(teams, [...devices.values()], streamAllowed('screen', 'overlay', settings, contest, Date.now()));
    }

    function data() {
        const now = Date.now();
        const teams = options.teams();
        const bySeat = new Map(teams.filter((team) => team.seat).map((team) => [team.seat.toLowerCase(), team]));
        return {
            settings, screenNow: streamAllowed('screen', 'overlay', settings, contest, now), contest, teams,
            devices: [...devices.values()].sort((a, b) => a.seat.localeCompare(b.seat, 'zh-CN', { numeric: true })).map((device) => ({
                id: device._id, name: device.name, seat: device.seat, teamUid: device.teamUid,
                team: device.teamUid !== null ? teams.find((team) => team.uid === device.teamUid) ?? null : bySeat.get(device.seat.toLowerCase()) ?? null,
                url: captureUrl(device), online: isCaptureOnline(device, now), streams: isCaptureOnline(device, now) ? device.streams : [],
                lastSeen: device.lastSeen, client: device.client,
            })),
        };
    }

    function operate(name: string, payload: any) {
        switch (name) {
        case 'create': {
            const item = normalizeDeviceInput(payload);
            if (item.seat && [...devices.values()].some((device) => device.seat === item.seat)) throw new CaptureError(`座位 ${item.seat} 已有采集设备`);
            create(item);
            return { created: 1 };
        }
        case 'create_from_seats': {
            const seats = [...new Set(options.teams().map((team) => team.seat).filter(Boolean))];
            const existing = new Set([...devices.values()].map((device) => device.seat.toLowerCase()));
            const missing = seats.filter((seat) => !existing.has(seat.toLowerCase()));
            for (const seat of missing) create({ seat, name: seat, teamUid: null });
            return { created: missing.length, seats: seats.length };
        }
        case 'update': {
            const device = devices.get(String(payload.id));
            if (!device) throw new CaptureError('设备不存在', 404);
            Object.assign(device, normalizeDeviceInput(payload.device, device));
            return { ok: true };
        }
        case 'delete': {
            const ids: string[] = (payload.ids || []).map(String);
            let deleted = 0;
            for (const id of ids) if (devices.delete(id)) { deleted++; relay.kickDevice(id, '采集设备已被删除'); }
            return { deleted };
        }
        case 'regenerate': {
            const device = devices.get(String(payload.id));
            if (!device) throw new CaptureError('设备不存在', 404);
            device.secret = newCaptureSecret();
            relay.kickDevice(device._id, '采集链接已重新生成');
            return { url: captureUrl(device) };
        }
        case 'settings': {
            const previous = settings;
            settings = normalizeCaptureSettings(payload.settings, settings);
            const now = Date.now();
            if (!settings.enabled) for (const id of devices.keys()) relay.kickDevice(id, '本场比赛已停用画面采集，重新启用后会自动连接', 4005);
            else {
                if (JSON.stringify(captureProfile(settings)) !== JSON.stringify(captureProfile(previous))) relay.configureDevices(contestKey, captureProfile(settings));
                if (streamAllowed('screen', 'overlay', previous, contest, now) && !streamAllowed('screen', 'overlay', settings, contest, now)) relay.endOverlayScreens(contestKey);
            }
            return { settings };
        }
        default: throw new CaptureError('未知操作');
        }
    }

    const json = (response: ServerResponse, status: number, body: unknown) => response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));

    async function handle(request: IncomingMessage, response: ServerResponse, url: URL, readBody: (request: IncomingMessage) => Promise<any>) {
        if (url.pathname === `${base}/live/capture`) {
            if (request.method === 'POST') {
                const body = await readBody(request);
                try {
                    json(response, 200, operate(String(body.operation), body.payload ? JSON.parse(body.payload) : {}));
                } catch (error) {
                    json(response, error instanceof CaptureError ? error.status : 500, { error: (error as Error).message });
                }
                return true;
            }
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(env.render('xcpcio_live_capture.html', {
                codeBase, tdoc: { title: contest.title },
                runtimeJson: toScriptJson({
                    base: `${base}/live/capture`, dataUrl: `${base}/live/capture/data`, liveUrl: `${base}/live`, contestUrl: base,
                    viewerWs: `${base}/live/ws/capture`, title: contest.title,
                }),
            }));
            return true;
        }
        if (url.pathname === `${base}/live/capture/data`) {
            json(response, 200, data());
            return true;
        }
        const page = /^\/contest\/demo\/live-capture\/([a-f\d]{24})\/([\w-]+)$/.exec(url.pathname);
        if (page) {
            const device = devices.get(page[1]);
            if (!device || !captureSecretMatches(page[2], device.secret)) { response.writeHead(404).end('采集链接无效或已重新生成'); return true; }
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(env.render('xcpcio_live_capture_device.html', {
                codeBase, title: `${device.name} · 画面采集`,
                runtimeJson: toScriptJson({ ws: `${captureUrl(device)}/ws`, name: device.name, seat: device.seat, contest: contest.title }),
            }));
            return true;
        }
        return false;
    }

    /** Hydro's websocket layer, briefly: text ping/pong, JSON messages. */
    function keepAlive(ws: WebSocket, onMessage: (message: unknown) => void) {
        ws.on('message', (raw) => {
            const text = raw.toString();
            if (text === 'ping') { ws.send('pong'); return; }
            if (text === 'pong') return;
            try { onMessage(JSON.parse(text)); } catch { /* not JSON */ }
        });
    }

    /** Takes the capture websockets; false when the address is not one of them. */
    function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, server: WebSocketServer) {
        const url = new URL(request.url || '/', 'http://localhost');
        const deviceMatch = /^\/contest\/demo\/live-capture\/([a-f\d]{24})\/([\w-]+)\/ws$/.exec(url.pathname);
        const overlayMatch = /^\/contest\/demo\/live-overlay\/([^/]+)\/ws\/capture$/.exec(url.pathname);
        const staff = url.pathname === `${base}/live/ws/capture`;
        if (!deviceMatch && !overlayMatch && !staff) return false;
        server.handleUpgrade(request, socket, head, (ws) => {
            if (deviceMatch) {
                const device = devices.get(deviceMatch[1]);
                if (!device || !captureSecretMatches(deviceMatch[2], device.secret) || !settings.enabled) {
                    ws.close(4000, `CaptureError: ${!settings.enabled ? '本场比赛尚未启用画面采集，启用后会自动连接' : '采集链接无效或已重新生成，请向管理员获取新的链接'}`);
                    return;
                }
                const connection = `${relay.instance}/${Math.random()}`;
                const endpoint = { contestKey, connection, send: (message: unknown) => ws.send(JSON.stringify(message)), close: (code: number, reason: string) => ws.close(code, reason) };
                relay.attachDevice(device._id, endpoint);
                Object.assign(device, { connection, lastSeen: new Date(), streams: [], client: { agent: String(request.headers['user-agent'] || ''), ip: '127.0.0.1', screen: '' } });
                ws.send(JSON.stringify({ type: 'config', name: device.name, seat: device.seat, ...captureProfile(settings) }));
                keepAlive(ws, (message) => {
                    const input = message as Record<string, unknown>;
                    if (input?.type === 'status') {
                        if (device.connection !== connection) return;
                        device.lastSeen = new Date();
                        device.streams = (Array.isArray(input.streams) ? input.streams : []).filter((stream): stream is CaptureStream => captureStreams.includes(stream as CaptureStream));
                        if (device.client) device.client.screen = String(input.screen || '').slice(0, 40);
                        return;
                    }
                    relay.fromDevice(device._id, message);
                });
                ws.on('close', () => {
                    relay.detachDevice(device._id, endpoint);
                    if (device.connection === connection) Object.assign(device, { connection: null, streams: [] });
                });
                return;
            }
            if (overlayMatch && overlayMatch[1] !== options.overlayToken()) { ws.close(4004, '直播链接已作废'); return; }
            const kind = staff ? 'staff' as const : 'overlay' as const;
            const viewer = relay.attachViewer({
                contestKey, kind, token: overlayMatch?.[1] || '',
                send: (message) => ws.send(JSON.stringify(message)),
                close: (code, reason) => ws.close(code, reason),
                allow: async (id, stream) => {
                    const device = devices.get(id);
                    if (!device) return '设备不存在';
                    if (!settings.enabled) return '本场比赛未启用画面采集';
                    if (!streamAllowed(stream, kind, settings, contest, Date.now())) return '比赛结束前不提供屏幕画面';
                    if (!isCaptureOnline(device, Date.now())) return '设备未在线';
                    if (!device.streams.includes(stream)) return stream === 'screen' ? '该设备没有在采集屏幕' : '该设备没有在采集摄像头';
                    return true;
                },
            });
            ws.send(JSON.stringify({ type: 'config', iceServers: settings.iceServers }));
            keepAlive(ws, (message) => { relay.fromViewer(viewer, message).catch(() => null); });
            ws.on('close', () => relay.detachViewer(viewer));
        });
        return true;
    }

    return {
        handle, upgrade, medias,
        revoke: (token: string) => relay.closeViewers(contestKey, 4004, '直播链接已作废', (endpoint) => endpoint.kind !== 'overlay' || endpoint.token === token),
    };
}
