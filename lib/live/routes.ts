import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
    ConnectionHandler, ContestModel, Context, Handler, NotFoundError, ObjectId, param, PERM, Tdoc, Types,
} from 'hydrooj';
import type { BoardData } from '../board';
import type { BoardSettings } from '../settings';
import { toScriptJson } from '../settings';
import { resolverBoards, resolverCodeBase } from '../resolver-data';
import {
    adminApi, adminChannels, type ApiResponse, builtinMediaNames, defaultVisualConfig, liveUrls, type LiveStore, overlayApi, overlayChannel,
    pluginRoot, readBuiltinMedia, shell, storeName,
} from './api';
import { LiveHub, type LiveState } from './hub';

interface LiveDoc {
    _id: string;
    token: string;
    /** Separate from the overlay token, so pictures placed in captions survive a token reset. */
    mediaKey: string;
    visualConfig: string;
    state: LiveState;
    updatedAt: Date;
}
interface LiveMedia {
    _id: string;
    key: string;
    name: string;
    mime: string;
    size: number;
    data: Buffer;
    createdAt: Date;
}
declare module 'hydrooj' {
    interface Collections {
        'xcpcio.live': LiveDoc;
        'xcpcio.live.media': LiveMedia;
    }
}

const newToken = () => randomBytes(24).toString('hex');
const sameSecret = (given: string, expected: string) => {
    const buffer = Buffer.from(String(given));
    return buffer.length === Buffer.byteLength(expected) && timingSafeEqual(buffer, Buffer.from(expected));
};

export function applyLive(ctx: Context, dependencies: {
    loadSettings: (tdoc: Tdoc) => Promise<BoardSettings>;
    loadData: (tdoc: Tdoc, realtime: boolean, identity: boolean, staffResults: boolean) => Promise<BoardData>;
    intervalMs?: number;
}) {
    const collection = ctx.db.collection('xcpcio.live');
    const media = ctx.db.collection('xcpcio.live.media');
    const logoNames = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'logos/index.json'), 'utf8')).names;
    const version = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).version;
    const codeBase = resolverCodeBase(version);
    const key = (tdoc: Tdoc) => `${tdoc.domainId}/${tdoc.docId}`;
    const contestBase = (tdoc: Tdoc) => `/d/${encodeURIComponent(tdoc.domainId)}/contest/${tdoc.docId}`;
    const urls = (tdoc: Tdoc, doc: LiveDoc) => liveUrls(contestBase(tdoc), doc.token, doc.mediaKey);
    const hubs = new Map<string, Promise<LiveHub>>();

    async function loadDoc(tdoc: Tdoc): Promise<LiveDoc> {
        const doc: LiveDoc = {
            _id: key(tdoc), token: newToken(), mediaKey: newToken(), visualConfig: defaultVisualConfig(tdoc.title), state: {}, updatedAt: new Date(),
        };
        // Two administrators opening the page at once must end up with the same token.
        await collection.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
        return (await collection.findOne({ _id: doc._id }))!;
    }

    async function readMedia(contestKey: string, name: string) {
        const stored = await media.findOne({ _id: `${contestKey}/${name}` });
        if (stored) return { data: Buffer.from((stored.data as unknown as { buffer?: Uint8Array }).buffer ?? stored.data), mime: stored.mime };
        return readBuiltinMedia(name);
    }

    function store(contestKey: string): LiveStore {
        return {
            visualConfig: async () => (await collection.findOne({ _id: contestKey }))?.visualConfig || '{}',
            saveVisualConfig: async (value) => { await collection.updateOne({ _id: contestKey }, { $set: { visualConfig: value, updatedAt: new Date() } }); },
            mediaNames: async () => {
                const stored = await media.find({ key: contestKey }, { projection: { name: 1 } }).toArray();
                return [...new Set([...await builtinMediaNames(), ...stored.map((item) => item.name)])].sort();
            },
            saveMedia: async (name, data, mime) => {
                await media.updateOne({ _id: `${contestKey}/${name}` },
                    { $set: { key: contestKey, name, mime, size: data.length, data, createdAt: new Date() } }, { upsert: true });
            },
        };
    }

    function hubFor(tdoc: Tdoc): Promise<LiveHub> {
        const name = key(tdoc);
        let hub = hubs.get(name);
        if (!hub) {
            const { domainId, docId } = tdoc;
            hub = loadDoc(tdoc).then(async (doc) => {
                const created = new LiveHub({
                    intervalMs: dependencies.intervalMs,
                    load: async () => {
                        const current = await ContestModel.get(domainId, docId);
                        if (!current) return null;
                        const settings = await dependencies.loadSettings(current);
                        // Same data as the public board and the screens: frozen, with the venue's identity rule.
                        const data = await dependencies.loadData(current, false, settings.showIdentity, false);
                        return {
                            contest: current, data, settings, identity: settings.showIdentity, logoNames, now: Date.now(),
                            boards: resolverBoards(data, settings, settings.showIdentity),
                        };
                    },
                    persist: async (state) => { await collection.updateOne({ _id: name }, { $set: { state, updatedAt: new Date() } }); },
                    template: async (template) => {
                        if (!template.endsWith('.svg')) return null;
                        const file = await readMedia(name, storeName(template));
                        return file ? file.data.toString('utf8') : null;
                    },
                }, doc.state);
                await created.ready;
                return created;
            });
            hub.catch(() => hubs.delete(name));
            hubs.set(name, hub);
        }
        return hub;
    }
    // A contest nobody has watched for half an hour gives its memory back; its widget state is saved.
    const sweeper = setInterval(async () => {
        for (const [name, pending] of hubs) {
            const hub = await pending.catch(() => null);
            if (hub && hub.idleFor() > 30 * 60_000 && hubs.get(name) === pending) {
                hubs.delete(name);
                hub.dispose();
            }
        }
    }, 5 * 60_000);
    sweeper.unref?.();
    ctx.effect(() => () => {
        clearInterval(sweeper);
        for (const hub of hubs.values()) hub.then((item) => item.dispose(), () => null);
        hubs.clear();
    });

    async function checkAdmin(handler: Handler | ConnectionHandler, tid: ObjectId) {
        const tdoc = await ContestModel.get(handler.domain._id, tid);
        if (!tdoc) throw new NotFoundError('Contest not found');
        if (!handler.user._id) throw new NotFoundError('请登录比赛管理账号');
        if (!handler.user.own(tdoc)) handler.checkPerm(PERM.PERM_EDIT_CONTEST);
        if (tdoc.rule !== 'acm') throw new NotFoundError('直播仅支持 ACM 比赛');
        return tdoc;
    }

    async function checkToken(domainId: string, tid: ObjectId, token: string) {
        const tdoc = await ContestModel.get(domainId, tid);
        const doc = tdoc?.rule === 'acm' ? await collection.findOne({ _id: key(tdoc) }) : null;
        if (!tdoc || !doc || !sameSecret(token, doc.token)) throw new NotFoundError('直播链接无效或已作废');
        return { tdoc, doc };
    }

    const respond = (handler: Handler, response: ApiResponse | null, what: string) => {
        if (!response) throw new NotFoundError(what);
        handler.response.status = response.status;
        handler.response.type = response.type;
        handler.response.body = response.body;
    };

    /** Hydro page: links for OBS and the director, and the token reset. */
    class LiveConfigHandler extends Handler {
        tdoc!: Tdoc;

        @param('tid', Types.ObjectId)
        async prepare(_domainId: string, tid: ObjectId) {
            this.response.addHeader('Cache-Control', 'no-store');
            this.tdoc = await checkAdmin(this, tid);
        }

        async get() {
            const links = urls(this.tdoc, await loadDoc(this.tdoc));
            this.response.template = 'xcpcio_live.html';
            this.response.body = {
                tdoc: this.tdoc, codeBase,
                runtimeJson: toScriptJson({ base: links.root, contestUrl: contestBase(this.tdoc), title: this.tdoc.title, overlay: links.overlay, admin: links.adminBase }),
            };
        }

        async postResetToken() {
            const doc = await loadDoc(this.tdoc);
            const token = newToken();
            await collection.updateOne({ _id: doc._id }, { $set: { token, updatedAt: new Date() } });
            this.response.body = { overlay: urls(this.tdoc, { ...doc, token }).overlay };
        }
    }

    /** The director's console (ICPC Live admin), behind the Hydro login. */
    class LiveAdminPageHandler extends Handler {
        @param('tid', Types.ObjectId)
        async get(_domainId: string, tid: ObjectId) {
            const tdoc = await checkAdmin(this, tid);
            this.response.addHeader('Cache-Control', 'no-store');
            this.response.type = 'text/html';
            this.response.body = shell('admin', urls(tdoc, await loadDoc(tdoc)), `${tdoc.title} · 直播导播台`);
        }
    }

    /** admin-home-page: version and useful links. */
    class LiveMainPageHandler extends Handler {
        @param('tid', Types.ObjectId)
        @param('item', Types.String)
        async get(_domainId: string, tid: ObjectId, item: string) {
            const tdoc = await checkAdmin(this, tid);
            const links = urls(tdoc, await loadDoc(tdoc));
            this.response.type = 'application/json';
            this.response.body = JSON.stringify(item === 'git'
                ? { commit: '200c82f', branch: 'v3.5.1', description: `ICPC Live v3.5.1 · hydro-scoreboard-xcpcio-plus ${version}` }
                : [
                    { name: '导播控制 /admin/controls', url: `${links.adminBase}/controls` },
                    { name: 'OBS 画面 /overlay?noStatus', url: `${links.overlay}?noStatus` },
                    { name: '直播设置', url: links.root },
                    { name: 'https://github.com/icpc/live-v3', url: 'https://github.com/icpc/live-v3' },
                ]);
        }
    }

    /** ICPC Live /api/admin. */
    class LiveAdminApiHandler extends Handler {
        notUsage = true;
        tdoc!: Tdoc;

        @param('tid', Types.ObjectId)
        async prepare(_domainId: string, tid: ObjectId) {
            this.response.addHeader('Cache-Control', 'no-store');
            this.tdoc = await checkAdmin(this, tid);
        }

        async all() {
            const hub = await hubFor(this.tdoc);
            hub.touch();
            if (!hub.info) await hub.refresh();
            const subpath = /\/live\/api\/admin\/(.*)$/.exec(this.request.path)?.[1] || '';
            const files = Object.values(this.request.files || {}).flat().map((file) => ({
                name: file.originalFilename || path.basename(file.filepath), size: file.size, read: () => fs.promises.readFile(file.filepath),
            }));
            respond(this, await adminApi(hub, store(key(this.tdoc)), {
                method: this.request.method, subpath, query: this.request.query, querystring: this.request.querystring,
                body: this.request.body, files, user: this.user.uname,
            }), subpath);
        }
    }

    /** Admin websockets: analytics, spotlight, social, contest info, backend log, admin actions. */
    class LiveAdminConnectionHandler extends ConnectionHandler {
        unsubscribe?: () => void;

        @param('tid', Types.ObjectId)
        async prepare(_domainId: string, tid: ObjectId) {
            const tdoc = await checkAdmin(this, tid);
            const channel = /\/live\/ws\/admin\/(.+)$/.exec(this.request.path)?.[1];
            if (!channel || !adminChannels.includes(channel)) throw new NotFoundError(channel || 'channel');
            const hub = await hubFor(tdoc);
            this.unsubscribe = hub.subscribe(channel, (payload) => this.send(typeof payload === 'string' ? payload : JSON.stringify(payload)));
        }

        async cleanup() { this.unsubscribe?.(); }
    }

    /** /api/overlay over HTTP for OBS: token in the path, no Hydro login. */
    class LiveOverlayApiHandler extends Handler {
        noCheckPermView = true;
        notUsage = true;

        @param('tid', Types.ObjectId)
        @param('token', Types.String)
        async get(_domainId: string, tid: ObjectId, token: string) {
            this.response.addHeader('Cache-Control', 'no-store');
            const { tdoc, doc } = await checkToken(this.domain._id, tid, token);
            const subpath = /\/api\/overlay\/(.*)$/.exec(this.request.path)?.[1] || '';
            respond(this, await overlayApi(await hubFor(tdoc), subpath, doc.visualConfig), subpath);
        }
    }

    /** /api/overlay websockets for OBS. */
    class LiveOverlayConnectionHandler extends ConnectionHandler {
        noCheckPermView = true;
        unsubscribe?: () => void;

        @param('tid', Types.ObjectId)
        @param('token', Types.String)
        async prepare(_domainId: string, tid: ObjectId, token: string) {
            const { tdoc } = await checkToken(this.domain._id, tid, token);
            const channel = overlayChannel(/\/ws\/overlay\/(.+)$/.exec(this.request.path)?.[1] || '');
            if (!channel) throw new NotFoundError('channel');
            const hub = await hubFor(tdoc);
            this.unsubscribe = hub.subscribe(channel, (payload) => this.send(typeof payload === 'string' ? payload : JSON.stringify(payload)));
        }

        async cleanup() { this.unsubscribe?.(); }
    }

    class LiveOverlayPageHandler extends Handler {
        noCheckPermView = true;

        @param('tid', Types.ObjectId)
        @param('token', Types.String)
        async get(_domainId: string, tid: ObjectId, token: string) {
            const { tdoc, doc } = await checkToken(this.domain._id, tid, token);
            this.response.addHeader('Cache-Control', 'no-store');
            this.response.type = 'text/html';
            this.response.body = shell('overlay', urls(tdoc, doc), `${tdoc.title} · 直播画面`);
        }
    }

    class LiveMediaHandler extends Handler {
        noCheckPermView = true;
        notUsage = true;

        @param('tid', Types.ObjectId)
        @param('mediaKey', Types.String)
        @param('name', Types.String)
        async get(_domainId: string, tid: ObjectId, mediaKey: string, name: string) {
            const tdoc = await ContestModel.get(this.domain._id, tid);
            const doc = tdoc ? await collection.findOne({ _id: key(tdoc) }) : null;
            if (!tdoc || !doc || !sameSecret(mediaKey, doc.mediaKey)) throw new NotFoundError('media');
            const file = await readMedia(doc._id, storeName(name));
            if (!file) throw new NotFoundError(name);
            this.response.addHeader('Cache-Control', 'private, max-age=60');
            // Uploaded SVG must not run script in the Hydro origin when opened directly.
            this.response.addHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
            this.response.addHeader('X-Content-Type-Options', 'nosniff');
            this.response.type = file.mime;
            this.response.body = file.data;
        }
    }

    ctx.Route('contest_xcpcio_live', '/contest/:tid/live', LiveConfigHandler);
    ctx.Route('contest_xcpcio_live_admin', '/contest/:tid/live/admin', LiveAdminPageHandler);
    ctx.Route('contest_xcpcio_live_admin_page', '/contest/:tid/live/admin/*page', LiveAdminPageHandler);
    ctx.Route('contest_xcpcio_live_main_page', '/contest/:tid/live/main-page/:item', LiveMainPageHandler);
    ctx.Route('contest_xcpcio_live_admin_api', '/contest/:tid/live/api/admin/*path', LiveAdminApiHandler);
    ctx.Connection('contest_xcpcio_live_admin_ws', '/contest/:tid/live/ws/admin/*path', LiveAdminConnectionHandler);
    ctx.Route('contest_xcpcio_live_overlay', '/contest/:tid/live-overlay/:token', LiveOverlayPageHandler);
    ctx.Route('contest_xcpcio_live_overlay_api', '/contest/:tid/live-overlay/:token/api/overlay/*path', LiveOverlayApiHandler);
    ctx.Connection('contest_xcpcio_live_overlay_ws', '/contest/:tid/live-overlay/:token/ws/overlay/*path', LiveOverlayConnectionHandler);
    ctx.Route('contest_xcpcio_live_media', '/contest/:tid/live-media/:mediaKey/:name', LiveMediaHandler);
    ctx.i18n.load('zh', { contest_xcpcio_live: '直播' });
}
