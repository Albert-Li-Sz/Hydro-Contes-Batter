import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Environment } from 'nunjucks';
import type { Context } from 'hydrooj';
import type { BoardData } from '../lib/board';
import type { BoardSettings } from '../lib/settings';
import { awardsFor, toScriptJson } from '../lib/settings';
import { resolverBoards, resolverCodeBase } from '../lib/resolver-data';
import { ResolverSessions } from '../lib/resolver-sessions';
import {
    defaultScreenConfig, normalizeScreenConfig, presentationItem, screenData, ScreenError, screenLabels,
    ScreenType, screenTypes, screenVariants, standingsTypes,
} from '../lib/screens-data';

/** Local preview of the big-screen pages. Mirrors lib/screens-routes.ts without Hydro or MongoDB. */
export function createScreensPreview(env: Environment, logoNames: Record<string, string>, version: string, db: Context['db']) {
    const codeBase = resolverCodeBase(version);
    const sessions = new ResolverSessions(db);
    const base = '/contest/demo';
    let config = defaultScreenConfig();
    let token = 'preview0000000000000000000000000000000000000000';
    return async (request: IncomingMessage, response: ServerResponse, url: URL, data: BoardData, settings: BoardSettings) => {
        const json = (value: unknown, status = 200) => response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
        const boards = resolverBoards(data, settings, settings.showIdentity);
        try {
            if (url.pathname === `${base}/screens`) {
                if (request.method === 'POST') {
                    let text = '';
                    for await (const chunk of request) text += chunk;
                    const body = JSON.parse(text || '{}');
                    if (body.operation === 'reset_token') {
                        token = `preview${Date.now().toString(16).padStart(41, '0')}`;
                        json({ linkBase: `${base}/screen/${token}` });
                    } else {
                        config = normalizeScreenConfig(JSON.parse(body.config), config);
                        json({ config });
                    }
                    return true;
                }
                const own = await sessions.list({ domainId: 'system', contestId: 'demo', ownerId: 1 });
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(env.render('xcpcio_screens.html', {
                    codeBase, tdoc: { title: data.contest.contest_name }, runtimeJson: toScriptJson({
                        base: `${base}/screens`, contestUrl: `${base}/scoreboard/xcpcio-plus`, linkBase: `${base}/screen/${token}`,
                        title: data.contest.contest_name, config, types: screenTypes, labels: screenLabels, variants: screenVariants,
                        standingsTypes: [...standingsTypes], boards: boards.map(({ id, name }) => ({ id, name })),
                        sessions: own.map((row) => ({ id: row.id, createdAt: row.createdAt, title: row.overview.title,
                            board: boards.find((board) => board.id === row.config.boardId)?.name || row.config.boardId, rehearsal: row.config.rehearsal })),
                        contest: { start: new Date(data.contest.start_time * 1000).toISOString(), end: new Date(data.contest.end_time * 1000).toISOString() },
                    }),
                }));
                return true;
            }
            const match = /^\/contest\/demo\/screen\/([^/]+)\/([a-z-]+)(\/data)?$/.exec(url.pathname);
            if (!match) return false;
            if (match[1] !== token || !screenTypes.includes(match[2] as ScreenType)) throw new ScreenError('大屏链接无效或已作废', 404);
            const type = match[2] as ScreenType;
            if (!match[3]) {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(env.render('xcpcio_screen_view.html', {
                    codeBase, title: `${data.contest.contest_name} · ${screenLabels[type]}`,
                    runtimeJson: toScriptJson({ type, dataUrl: `${url.pathname}/data${url.search}` }),
                }));
                return true;
            }
            const item = config.items[type];
            const head = { type, locale: config.locale, serverTime: Date.now() };
            if (type === 'resolver') {
                const session = item.sessionId ? await sessions.find('system', 'demo', item.sessionId) : null;
                if (!session) json({ ...head, notice: '等待滚榜开始' });
                else if (session.revision === Number(url.searchParams.get('revision')) && session._id === url.searchParams.get('session')) {
                    json({ ...head, session: session._id, playback: sessions.playback(session) });
                } else json({ ...head, session: session._id, ...await sessions.spectator(session) });
                return true;
            }
            const boardId = standingsTypes.has(type) ? item.boardId : 'all';
            const board = boards.find((candidate) => candidate.id === boardId);
            if (!board) { json({ ...head, notice: '所选分榜已不存在，请在大屏管理页重新选择' }); return true; }
            json({ ...head, item: presentationItem(type, item, data),
                data: screenData(data, boardId === 'all' ? null : new Set(board.teamIds), { logoNames, locked: false,
                    firstSolve: awardsFor(settings, boardId).firstSolve, unofficialFirstSolve: awardsFor(settings, boardId).unofficialFirstSolve }) });
        } catch (error) {
            json({ error: error instanceof Error ? error.message : 'Invalid request' }, error instanceof ScreenError ? error.status : 400);
        }
        return true;
    };
}
