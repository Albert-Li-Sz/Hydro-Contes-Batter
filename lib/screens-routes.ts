import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
    ContestModel, Context, Handler, NotFoundError, ObjectId, param, PERM, Tdoc, Types,
} from 'hydrooj';
import type { BoardData } from './board';
import type { BoardSettings } from './settings';
import { toScriptJson } from './settings';
import { resolverBoards, resolverCodeBase } from './resolver-data';
import { awardsFor } from './settings';
import { ResolverSessions } from './resolver-sessions';
import {
    defaultScreenConfig, normalizeScreenConfig, presentationItem, ScreenConfig, screenData, ScreenError,
    screenLabels, ScreenType, screenTypes, screenVariants, standingsTypes,
} from './screens-data';

interface ScreenDoc {
    _id: string;
    token: string;
    config: ScreenConfig;
    updatedAt: Date;
    updatedBy: number;
}
declare module 'hydrooj' {
    interface Collections { 'xcpcio.screens': ScreenDoc }
}

const newToken = () => randomBytes(24).toString('hex');

export function applyScreens(ctx: Context, dependencies: {
    loadSettings: (tdoc: Tdoc) => Promise<BoardSettings>;
    loadData: (tdoc: Tdoc, realtime: boolean, identity: boolean, staffResults: boolean) => Promise<BoardData>;
}) {
    const collection = ctx.db.collection('xcpcio.screens');
    const sessions = new ResolverSessions(ctx.db);
    const logoNames = JSON.parse(fs.readFileSync(path.join(__dirname, '../logos/index.json'), 'utf8')).names;
    const codeBase = resolverCodeBase(JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version);
    const key = (tdoc: Tdoc) => `${tdoc.domainId}/${tdoc.docId}`;
    const contestBase = (tdoc: Tdoc) => `/d/${encodeURIComponent(tdoc.domainId)}/contest/${tdoc.docId}`;
    // Every screen polls; screens of one contest and board share a computation for a few seconds.
    const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
    // Every audience screen polls the same session; build each (session, progress) snapshot once.
    const spectators = new Map<string, Promise<unknown>>();
    // The audience screen is the venue's resolver display: it shows the snapshot exactly as the
    // presenter does, including the identity its creator chose to present.
    async function spectator(session: Parameters<ResolverSessions['spectator']>[0]) {
        const name = `${session._id}@${session.revision}`;
        let value = spectators.get(name);
        if (!value) {
            value = sessions.spectator(session);
            value.catch(() => spectators.delete(name));
            spectators.set(name, value);
            while (spectators.size > 16) spectators.delete(spectators.keys().next().value!);
        }
        return value as Promise<Record<string, unknown>>;
    }

    async function loadDoc(tdoc: Tdoc, userId?: number) {
        const existing = await collection.findOne({ _id: key(tdoc) });
        if (existing) return { ...existing, config: normalizeScreenConfig(existing.config) };
        if (userId === undefined) return null;
        const doc: ScreenDoc = { _id: key(tdoc), token: newToken(), config: defaultScreenConfig(), updatedAt: new Date(), updatedBy: userId };
        // Two administrators opening the page at once must end up with the same token.
        await collection.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
        return (await collection.findOne({ _id: doc._id }))!;
    }

    async function source(tdoc: Tdoc) {
        const settings = await dependencies.loadSettings(tdoc);
        // Screens are seen by anyone in the room: same data and identity rules as the public board.
        const data = await dependencies.loadData(tdoc, false, settings.showIdentity, false);
        return { settings, data, boards: resolverBoards(data, settings, settings.showIdentity) };
    }

    class ScreensHandler extends Handler {
        tdoc!: Tdoc;

        @param('tid', Types.ObjectId)
        async prepare(_domainId: string, tid: ObjectId) {
            this.response.addHeader('Cache-Control', 'no-store');
            const tdoc = await ContestModel.get(this.domain._id, tid);
            if (!tdoc) throw new NotFoundError('Contest not found');
            if (!this.user._id) throw new ScreenError('请登录比赛管理账号', 403);
            if (!this.user.own(tdoc)) this.checkPerm(PERM.PERM_EDIT_CONTEST);
            if (tdoc.rule !== 'acm') throw new ScreenError('大屏仅支持 ACM 比赛');
            this.tdoc = tdoc;
        }

        async get() {
            const doc = (await loadDoc(this.tdoc, this.user._id))!;
            const { boards } = await source(this.tdoc);
            const scope = { domainId: this.tdoc.domainId, contestId: String(this.tdoc.docId), ownerId: this.user._id };
            const base = contestBase(this.tdoc);
            this.response.template = 'xcpcio_screens.html';
            this.response.body = {
                tdoc: this.tdoc, codeBase,
                runtimeJson: toScriptJson({
                    base: `${base}/screens`, contestUrl: base, linkBase: `${base}/screen/${doc.token}`,
                    title: this.tdoc.title, config: doc.config, types: screenTypes, labels: screenLabels, variants: screenVariants,
                    standingsTypes: [...standingsTypes], boards: boards.map(({ id, name }) => ({ id, name })),
                    sessions: (await sessions.list(scope)).map((row) => ({
                        id: row.id, createdAt: row.createdAt, title: row.overview.title,
                        board: boards.find((board) => board.id === row.config.boardId)?.name || row.config.boardId,
                        rehearsal: row.config.rehearsal,
                    })),
                    contest: { start: this.tdoc.beginAt.toISOString(), end: this.tdoc.endAt.toISOString() },
                }),
            };
        }

        @param('config', Types.String)
        async post(_domainId: string, raw: string) {
            if (raw.length > 20000) throw new ScreenError('大屏配置内容过大');
            let input: unknown;
            try { input = JSON.parse(raw); } catch { throw new ScreenError('大屏配置必须是有效 JSON'); }
            const doc = (await loadDoc(this.tdoc, this.user._id))!;
            const config = normalizeScreenConfig(input, doc.config);
            await collection.updateOne({ _id: doc._id }, { $set: { config, updatedAt: new Date(), updatedBy: this.user._id } });
            this.response.body = { config };
        }

        async postResetToken() {
            const doc = (await loadDoc(this.tdoc, this.user._id))!;
            const token = newToken();
            await collection.updateOne({ _id: doc._id }, { $set: { token, updatedAt: new Date(), updatedBy: this.user._id } });
            this.response.body = { linkBase: `${contestBase(this.tdoc)}/screen/${token}` };
        }

        async onerror(error: Parameters<Handler['onerror']>[0] | ScreenError) {
            if (error instanceof ScreenError) {
                this.response.status = error.status;
                this.response.body = { error: error.message };
                return;
            }
            return super.onerror(error);
        }
    }

    /** Screen links carry their own capability, so venue computers need no Hydro login. */
    class ScreenPublicHandler extends Handler {
        noCheckPermView = true;
        tdoc!: Tdoc;
        doc!: ScreenDoc;
        type!: ScreenType;

        @param('tid', Types.ObjectId)
        @param('token', Types.String)
        @param('type', Types.String)
        async prepare(_domainId: string, tid: ObjectId, token: string, type: string) {
            this.response.addHeader('Cache-Control', 'no-store');
            const tdoc = await ContestModel.get(this.domain._id, tid);
            const doc = tdoc?.rule === 'acm' ? await loadDoc(tdoc) : null;
            const given = Buffer.from(String(token));
            if (!tdoc || !doc || !screenTypes.includes(type as ScreenType)
                || given.length !== Buffer.byteLength(doc.token) || !timingSafeEqual(given, Buffer.from(doc.token))) {
                throw new NotFoundError('大屏链接无效或已作废');
            }
            this.tdoc = tdoc;
            this.doc = doc;
            this.type = type as ScreenType;
        }
    }

    class ScreenViewHandler extends ScreenPublicHandler {
        async get() {
            this.response.template = 'xcpcio_screen_view.html';
            this.response.body = {
                codeBase, title: `${this.tdoc.title} · ${screenLabels[this.type]}`,
                runtimeJson: toScriptJson({ type: this.type, dataUrl: `${contestBase(this.tdoc)}/screen/${this.doc.token}/${this.type}/data` }),
            };
        }
    }

    class ScreenDataHandler extends ScreenPublicHandler {
        @param('revision', Types.Int, true)
        @param('session', Types.String, true)
        async get(_domainId: string, revision?: number, known?: string) {
            const { locale, items } = this.doc.config;
            const item = items[this.type];
            const base = { type: this.type, locale, serverTime: Date.now() };
            if (this.type === 'resolver') {
                const session = item.sessionId ? await sessions.find(this.tdoc.domainId, String(this.tdoc.docId), item.sessionId) : null;
                if (!session) {
                    this.response.body = { ...base, notice: '等待滚榜开始' };
                    return;
                }
                this.response.body = session.revision === revision && session._id === known
                    ? { ...base, session: session._id, playback: sessions.playback(session) }
                    : { ...base, session: session._id, ...await spectator(session) };
                return;
            }
            // Like the public board, standings stay hidden until the contest starts.
            if (standingsTypes.has(this.type) && !ContestModel.canShowScoreboard.call(this, this.tdoc, false)) {
                this.response.body = { ...base, notice: '比赛尚未开始' };
                return;
            }
            const boardId = standingsTypes.has(this.type) ? item.boardId : 'all';
            const cacheKey = `${key(this.tdoc)}|${boardId}`;
            const now = Date.now();
            for (const [name, entry] of cache) if (entry.expires <= now) cache.delete(name);
            let entry = cache.get(cacheKey);
            if (!entry) {
                const tdoc = this.tdoc;
                entry = {
                    expires: now + 3000,
                    value: source(tdoc).then(({ settings, data, boards }) => {
                        const board = boards.find((candidate) => candidate.id === boardId);
                        if (!board) throw new ScreenError('所选分榜已不存在，请在大屏管理页重新选择', 404);
                        const rules = awardsFor(settings, boardId);
                        return { contest: data.contest, data: screenData(data, boardId === 'all' ? null : new Set(board.teamIds), {
                            logoNames, locked: ContestModel.isLocked(tdoc), firstSolve: rules.firstSolve, unofficialFirstSolve: rules.unofficialFirstSolve,
                        }) };
                    }),
                };
                entry.value.catch(() => cache.delete(cacheKey));
                cache.set(cacheKey, entry);
            }
            try {
                const { contest, data } = await entry.value as { contest: BoardData['contest']; data: unknown };
                this.response.body = { ...base, item: presentationItem(this.type, item, { contest } as BoardData), data };
            } catch (error) {
                if (!(error instanceof ScreenError)) throw error;
                this.response.body = { ...base, notice: error.message };
            }
        }
    }

    ctx.Route('contest_xcpcio_screens', '/contest/:tid/screens', ScreensHandler);
    ctx.Route('contest_xcpcio_screen_view', '/contest/:tid/screen/:token/:type', ScreenViewHandler);
    ctx.Route('contest_xcpcio_screen_data', '/contest/:tid/screen/:token/:type/data', ScreenDataHandler);
    ctx.i18n.load('zh', { contest_xcpcio_screens: '大屏' });
}
