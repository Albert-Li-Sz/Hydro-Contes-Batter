import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context, Tdoc } from 'hydrooj';
import { defaultSettings } from '../lib/settings';
import { defaultProfileFields } from '../lib/roster';
import { previewDatabase } from '../preview/resolver-memory-db';

const state = vi.hoisted(() => ({ entries: [] as any[], users: {} as Record<number, any>, locked: false, ended: true, started: true, contest: null as any }));
vi.mock('hydrooj', () => {
    class ObjectId {
        constructor(public value: string) {}
        getTimestamp() { return new Date(Number.parseInt(`${this.value}`.slice(0, 8), 16) * 1000); }
        toString() { return `${this.value}`; }
    }
    class Handler {
        domain = { _id: 'system' };
        user = { _id: 10, own: () => false, hasPerm: (_perm: bigint) => false };
        request = { json: false, headers: {} as Record<string, string> };
        response: any = { addHeader: vi.fn() };
        checkPerm(perm: bigint) { if (!this.user.hasPerm(perm)) throw new Error('Forbidden'); }
    }
    const schema = () => new Proxy({}, { get: () => (..._args: any[]) => schema() });
    const names = ['ACCEPTED', 'WRONG_ANSWER', 'COMPILING', 'WAITING', 'JUDGING', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'RUNTIME_ERROR', 'SYSTEM_ERROR', 'COMPILE_ERROR', 'FETCHED', 'OUTPUT_LIMIT_EXCEEDED', 'ETC', 'CANCELED', 'HACKED', 'FORMAT_ERROR', 'IGNORED'];
    return {
        ObjectId, Handler, Schema: { object: schema, boolean: schema, number: schema, string: schema, array: schema },
        param: () => () => {},
        Types: { ObjectId: [(value: any) => new ObjectId(value)], Boolean: [(value: unknown) => value === true || value === 'true'] },
        STATUS: Object.fromEntries(names.map((name, index) => [`STATUS_${name}`, index + 1])),
        PERM: { PERM_EDIT_CONTEST: 1n, PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD: 2n, PERM_VIEW_USER_PRIVATE_INFO: 4n },
        avatar: () => '/avatar.png', getAlphabeticId: (index: number) => String.fromCharCode(65 + index),
        NotFoundError: class extends Error {}, ValidationError: class extends Error {}, ForbiddenError: class extends Error {},
        ContestModel: {
            get: vi.fn(async (domainId: string, tid: any) => ({ ...state.contest, domainId, docId: tid })),
            getMultiStatus: vi.fn(() => ({ toArray: async () => state.entries })),
            isDone: () => state.ended, isLocked: () => state.locked,
            canShowScoreboard(this: any, tdoc: any) { return state.started || this.user.own(tdoc) || this.user.hasPerm(2n); },
        },
        UserModel: { getList: vi.fn(async () => state.users) },
    };
});
import { ObjectId, STATUS } from 'hydrooj';
import { apply, loadContestData, loadRoster } from '../index';

function record(second: number, status = STATUS.STATUS_ACCEPTED, suffix = 1) {
    return { rid: `${Math.floor(second).toString(16)}${suffix.toString(16).padStart(16, '0')}`, pid: 100, status };
}

function setup(saved = new Map<string, any>(), config: Record<string, unknown> = {}) {
    const resolverDb = previewDatabase();
    const routes = new Map<string, any>();
    let view: any;
    let middleware: any;
    const collection = {
        findOne: async ({ _id }: { _id: string }) => saved.get(_id),
        updateOne: async ({ _id }: { _id: string }, { $set }: any) => { saved.set(_id, structuredClone($set)); },
    };
    const ctx: any = {
        db: { collection: (name: string) => name.startsWith('xcpcio.resolver.') ? resolverDb.db.collection(name as any) : collection },
        Route: (name: string, _path: string, handler: any) => { routes.set(name, handler); },
        i18n: { load: vi.fn() },
        inject: (_deps: string[], callback: any) => callback({
            scoreboard: { addView: (_id: string, _name: string, args: any, next: any) => { view = { ...next, args }; } },
            server: { addHandlerLayer: (_name: string, handler: any) => { middleware = handler; } },
        }),
        on: vi.fn(),
    };
    return {
        saved,
        init: () => apply(ctx as Context, { asDefault: true, publicByDefault: true, refreshInterval: 15000, profileFields: defaultProfileFields, ...config }),
        settings: () => new (routes.get('contest_xcpcio_plus_settings'))(),
        publicBoard: () => new (routes.get('contest_xcpcio_plus_public'))(),
        middleware: () => middleware,
        view: () => view,
        resolver: (name = '') => new (routes.get(`contest_resolver${name}`))(),
        resolverTables: resolverDb.tables,
        hooks: ctx.on,
    };
}

beforeEach(() => {
    state.contest = {
        domainId: 'system', docId: new ObjectId('68ea00000000000000000000'), title: '测试比赛', rule: 'acm',
        beginAt: new Date('2026-10-27T01:00:00Z'), endAt: new Date('2026-10-27T06:00:00Z'),
        lockAt: new Date('2026-10-27T05:00:00Z'), pids: [100], owner: 10,
    };
    const begin = state.contest.beginAt.getTime() / 1000;
    state.entries = [{ uid: 1, unrank: false, journal: [record(begin + 600)] }];
    state.users = { 1: { _id: 1, uname: '测试选手', school: '南京晓庄学院', avatar: '' } };
    state.locked = false; state.ended = true; state.started = true;
});

describe('Hydro 数据与权限', () => {
    it('匿名用户可访问公开 HTML 和 JSON，不需要域或比赛权限', async () => {
        const app = setup(); await app.init(); const handler = app.publicBoard();
        handler.user._id = 0;
        expect(handler.noCheckPermView).toBe(true);
        await handler.prepare('system', state.contest.docId);
        await handler.get('system', false, false);
        expect(handler.response.template).toBe('xcpcio_plus_board.html');
        expect(handler.response.body.settingsUrl).toBeNull();
        expect(JSON.parse(handler.response.body.runtimeJson).dataSource).toContain('/xcpcio-public?json=true');
        await handler.get('system', true, false);
        expect(handler.response.body.teams[0].team_id).toBe('1');
    });
    it('公开接口拒绝实时查询，封榜 JSON 不包含隐藏结果或管理资料', async () => {
        const app = setup(); await app.init(); const handler = app.publicBoard();
        state.locked = true; state.entries[0].journal = [record(state.contest.lockAt.getTime() / 1000 + 10)];
        state.users[1].group = ['内部用户组']; state.users[1].grade = '2026'; state.users[1].getFields = () => ['grade'];
        await handler.prepare('system', state.contest.docId);
        await expect(handler.get('system', true, true)).rejects.toThrow();
        await handler.get('system', true, false);
        expect(handler.response.body.submissions[0].status).toBe('FROZEN');
        expect(JSON.stringify(handler.response.body)).not.toContain('内部用户组');
        expect(handler.response.body.teams[0].fields).toBeUndefined();
        expect((await loadRoster(state.contest))[0].fields['profile:grade']).toEqual(['2026']);
    });
    it('关闭公开访问后匿名链接失效，管理权限仍受保护', async () => {
        const app = setup(); await app.init(); const admin = app.settings(); admin.user.own = () => true;
        await admin.prepare('system', state.contest.docId);
        await admin.post('system', JSON.stringify({ ...defaultSettings, publicAccess: false }));
        await expect(app.publicBoard().prepare('system', state.contest.docId)).rejects.toThrow();
        await expect(app.settings().prepare('system', state.contest.docId)).rejects.toThrow('Forbidden');
    });
    it('默认榜单在原生权限检查前跳转，保留查询和域', async () => {
        const app = setup(); await app.init(); const redirect = vi.fn(); const next = vi.fn(() => { throw new Error('Native checker reached'); });
        const response: any = { redirect: null };
        const context: any = { path: `/contest/${state.contest.docId}/scoreboard`, method: 'GET', querystring: 'group=official&json=true', HydroContext: { domain: { _id: 'private' }, args: { domainId: 'spoofed' }, response }, redirect };
        await app.middleware()(context, next);
        expect(next).not.toHaveBeenCalled();
        // Hydro's response layer sends the 302; a direct ctx.redirect() would be overwritten with `200 {}`.
        expect(redirect).not.toHaveBeenCalled();
        expect(response.redirect).toBe(`/d/private/contest/${state.contest.docId}/xcpcio-public?group=official&json=true`);
        expect(context.handler).toBeDefined();
    });
    it('非 ACM、其他视图、实时访问和关闭默认替换不接管', async () => {
        const app = setup(new Map(), { asDefault: false }); await app.init(); const next = vi.fn();
        const context = { path: `/contest/${state.contest.docId}/scoreboard`, method: 'GET', querystring: '', HydroContext: { domain: { _id: 'system' }, args: { domainId: 'system' } }, redirect: vi.fn() };
        await app.middleware()(context, next); expect(next).toHaveBeenCalledOnce();
        const enabled = setup(); await enabled.init();
        for (const change of [{ querystring: 'realtime=true' }, { method: 'POST' }, { path: `${context.path}/csv` }, { pendingError: new Error('Unknown domain') }]) {
            next.mockClear(); await enabled.middleware()({ ...context, ...change }, next); expect(next).toHaveBeenCalledOnce();
        }
        state.contest.rule = 'oi'; next.mockClear(); await enabled.middleware()(context, next); expect(next).toHaveBeenCalledOnce();
    });
    it('公开页不把受限比赛的分配信息带给浏览器', async () => {
        state.contest.assign = ['内部']; state.contest.content = '内部题面';
        const app = setup(); await app.init(); const handler = app.publicBoard();
        await handler.prepare('system', state.contest.docId); await handler.get('system');
        expect(handler.response.body.tdoc.assign).toBeUndefined();
        expect(handler.response.body.tdoc.content).toBeUndefined();
    });
    it('查询参数不能改变管理设置和公开入口所属的域', async () => {
        const app = setup(); await app.init();
        const admin = app.settings(); admin.user.own = () => true;
        await admin.prepare('spoofed', state.contest.docId);
        expect(admin.tdoc.domainId).toBe('system');
        const guest = app.publicBoard(); await guest.prepare('spoofed', state.contest.docId);
        expect(guest.tdoc.domainId).toBe('system');
    });
    it('每场比赛可关闭替换，或在不公开时跳转回受保护视图', async () => {
        const app = setup(); await app.init(); const admin = app.settings(); admin.user.own = () => true;
        await admin.prepare('system', state.contest.docId);
        const next = vi.fn(); const response: any = { redirect: null };
        const context = { path: `/contest/${state.contest.docId}/scoreboard`, method: 'GET', querystring: '', HydroContext: { domain: { _id: 'system' }, args: { domainId: 'system' }, response }, redirect: vi.fn() };
        await admin.post('system', JSON.stringify({ ...defaultSettings, replaceNative: false }));
        await app.middleware()(context, next); expect(next).toHaveBeenCalledOnce();
        await admin.post('system', JSON.stringify({ ...defaultSettings, publicAccess: false }));
        await app.middleware()(context, next);
        expect(response.redirect).toBe(`/d/system/contest/${state.contest.docId}/scoreboard/xcpcio-plus`);
    });
    it('封榜时隐藏边界之后的结果（边界当秒与 Hydro 一样可见），实时模式保留结果', async () => {
        const lock = state.contest.lockAt.getTime() / 1000;
        state.entries[0].journal = [record(lock), record(lock + 1, STATUS.STATUS_ACCEPTED, 2)];
        state.locked = true;
        expect((await loadContestData(state.contest as Tdoc, false)).submissions.map((record) => record.status)).toEqual(['CORRECT', 'FROZEN']);
        expect((await loadContestData(state.contest as Tdoc, true)).submissions.every((record) => record.status === 'CORRECT')).toBe(true);
    });
    it('重判使用最新记录，同一提交不重复计罚', async () => {
        const first = state.entries[0].journal[0];
        state.entries[0].journal.push({ ...first, status: STATUS.STATUS_WRONG_ANSWER });
        const result = await loadContestData(state.contest as Tdoc, false);
        expect(result.submissions).toHaveLength(1); expect(result.submissions[0].status).toBe('WRONG_ANSWER');
    });
    it('过滤赛前、结束边界和非本场题目的提交', async () => {
        const start = state.contest.beginAt.getTime() / 1000;
        const end = state.contest.endAt.getTime() / 1000;
        state.entries[0].journal.push(record(start - 1, STATUS.STATUS_ACCEPTED, 2), record(end, STATUS.STATUS_ACCEPTED, 3), { ...record(start + 100, STATUS.STATUS_ACCEPTED, 4), pid: 999 });
        expect((await loadContestData(state.contest as Tdoc, false)).submissions).toHaveLength(1);
    });
    it('未保存设置的比赛默认不公开，需在插件配置或比赛设置中开启', async () => {
        const app = setup(new Map(), { publicByDefault: false }); await app.init();
        await expect(app.publicBoard().prepare('system', state.contest.docId)).rejects.toThrow();
        const admin = app.settings(); admin.user.own = () => true;
        await admin.prepare('system', state.contest.docId);
        await admin.post('system', JSON.stringify({ ...defaultSettings, publicAccess: true }));
        await app.publicBoard().prepare('system', state.contest.docId);
    });
    it('与 Hydro 原生规则一致地计罚：系统错误与 Hack 计罚，格式错误不计', async () => {
        const begin = state.contest.beginAt.getTime() / 1000;
        state.entries[0].journal = [record(begin + 60, STATUS.STATUS_SYSTEM_ERROR, 2), record(begin + 70, STATUS.STATUS_HACKED, 3),
            record(begin + 80, STATUS.STATUS_FORMAT_ERROR, 4), record(begin + 90, STATUS.STATUS_ETC, 5)];
        expect((await loadContestData(state.contest as Tdoc, false)).submissions.map((item) => item.status))
            .toEqual(['JUDGEMENT_FAILED', 'HACKED', 'PRESENTATION_ERROR', 'JUDGEMENT_FAILED']);
        state.ended = false;
        expect((await loadContestData(state.contest as Tdoc, false)).submissions[1].status).toBe('REJECTED');
    });
    it('个人计时比赛与 Hydro 原生一致，从比赛开始时间计时', async () => {
        const begin = state.contest.beginAt.getTime() / 1000;
        state.contest.duration = 1;
        state.entries[0].startAt = new Date((begin + 3600) * 1000);
        state.entries[0].journal = [record(begin + 3600 + 600), record(begin + 3600 + 3700, STATUS.STATUS_ACCEPTED, 2)];
        const result = await loadContestData(state.contest as Tdoc, false);
        expect(result.submissions.map((item) => item.timestamp)).toEqual([4200000, 7300000]);
    });
    it('保存时移除已退出比赛的成员，而不是拒绝整份设置', async () => {
        const app = setup(); await app.init(); const handler = app.settings(); handler.user.own = () => true;
        await handler.prepare('system', state.contest.docId);
        await handler.post('system', JSON.stringify({ ...defaultSettings, manualBoards: [{ id: 'a', name: '甲', teamIds: ['1', '999'] }] }));
        expect([...app.saved.values()][0].settings.manualBoards[0].teamIds).toEqual(['1']);
    });
    it('公开 JSON 在短时间内复用计算结果，保存设置后立即失效', async () => {
        const app = setup(); await app.init(); const guest = app.publicBoard();
        await guest.prepare('system', state.contest.docId);
        const { UserModel } = await import('hydrooj');
        const before = vi.mocked(UserModel.getList).mock.calls.length;
        await guest.get('system', true, false); await guest.get('system', true, false);
        expect(vi.mocked(UserModel.getList).mock.calls.length).toBe(before + 1);
        const admin = app.settings(); admin.user.own = () => true;
        await admin.prepare('system', state.contest.docId);
        await admin.post('system', JSON.stringify({ ...defaultSettings, publicAccess: true, schoolBoards: false }));
        const after = vi.mocked(UserModel.getList).mock.calls.length;
        const fresh = app.publicBoard(); await fresh.prepare('system', state.contest.docId); await fresh.get('system', true, false);
        expect(vi.mocked(UserModel.getList).mock.calls.length).toBe(after + 1);
        expect(Object.values(fresh.response.body.contest.group)).not.toContain('南京晓庄学院榜');
    });
    it('真实姓名与学校默认只给有私有资料权限的用户，开启后才对所有观众显示', async () => {
        state.users[1].displayName = '张三';
        const app = setup(); await app.init(); const guest = app.publicBoard();
        await guest.prepare('system', state.contest.docId); await guest.get('system', true, false);
        expect(guest.response.body.teams[0].name).toBe('测试选手');
        expect(JSON.stringify(guest.response.body)).not.toMatch(/张三|南京晓庄学院/);
        expect(guest.response.body.contest.options.enable_organization).toBe(false);
        const member = app.settings();
        await app.view().display.call(member, { tdoc: state.contest, realtime: false, json: true });
        expect(JSON.stringify(member.response.body)).not.toContain('张三');
        member.user.hasPerm = (perm: bigint) => perm === 4n;
        await app.view().display.call(member, { tdoc: state.contest, realtime: false, json: true });
        expect(member.response.body.teams[0].name).toBe('张三');
        expect(Object.values(member.response.body.contest.group)).toContain('南京晓庄学院榜');
        const admin = app.settings(); admin.user.own = () => true;
        await admin.prepare('system', state.contest.docId);
        await admin.post('system', JSON.stringify({ ...defaultSettings, publicAccess: true, showIdentity: true }));
        const open = app.publicBoard(); await open.prepare('system', state.contest.docId); await open.get('system', true, false);
        expect(open.response.body.teams[0]).toMatchObject({ name: '张三', organization: '南京晓庄学院' });
    });
    it('开赛前公开榜不可见，有隐藏榜权限的用户除外', async () => {
        state.started = false;
        const app = setup(); await app.init();
        await expect(app.publicBoard().prepare('system', state.contest.docId)).rejects.toThrow('比赛开始后');
        const owner = app.publicBoard(); owner.user.own = () => true;
        await owner.prepare('system', state.contest.docId);
    });
    it('缺少公开与身份字段的旧设置按关闭处理', async () => {
        const { publicAccess, showIdentity, ...legacy } = defaultSettings;
        const app = setup(new Map([[`system/${state.contest.docId}`, { settings: legacy }]])); await app.init();
        await expect(app.publicBoard().prepare('system', state.contest.docId)).rejects.toThrow();
    });
    it('忽略与未知状态和 Hydro 一样计罚', async () => {
        const begin = state.contest.beginAt.getTime() / 1000;
        state.entries[0].journal = [record(begin + 60, STATUS.STATUS_IGNORED, 2), record(begin + 70, 999 as never, 3)];
        expect((await loadContestData(state.contest as Tdoc, false)).submissions.map((item) => item.status)).toEqual(['REJECTED', 'JUDGEMENT_FAILED']);
    });
    it('封榜期间只给有权限的用户显示实时榜入口，实时榜提供返回入口', async () => {
        const app = setup(); await app.init(); state.locked = true;
        const guest = app.publicBoard(); await guest.prepare('system', state.contest.docId); await guest.get('system');
        expect(guest.response.body.realtimeUrl).toBeNull();
        const owner = app.publicBoard(); owner.user.own = () => true;
        await owner.prepare('system', state.contest.docId); await owner.get('system');
        expect(owner.response.body.realtimeUrl).toContain('/scoreboard/xcpcio-plus?realtime=true');
        await app.view().display.call(owner, { tdoc: state.contest, realtime: true, json: false });
        expect(owner.response.body.realtimeUrl).toBeNull();
        expect(owner.response.body.frozenUrl).toContain('/scoreboard/xcpcio-plus');
        state.locked = false; await owner.get('system');
        expect(owner.response.body.realtimeUrl).toBeNull();
    });
    it('其他进程保存设置后，本进程的公开缓存随设置版本失效', async () => {
        const saved = new Map<string, any>();
        const first = setup(saved); await first.init(); const second = setup(saved); await second.init();
        const admin = second.settings(); admin.user.own = () => true;
        await admin.prepare('system', state.contest.docId);
        await admin.post('system', JSON.stringify({ ...defaultSettings, publicAccess: true, manualBoards: [{ id: 'a', name: '甲组', teamIds: [] }] }));
        const before = first.publicBoard(); await before.prepare('system', state.contest.docId); await before.get('system', true, false);
        expect(Object.values(before.response.body.contest.group)).toContain('甲组');
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        await admin.post('system', JSON.stringify({ ...defaultSettings, publicAccess: true, manualBoards: [{ id: 'a', name: '乙组', teamIds: [] }] }));
        const after = first.publicBoard(); await after.prepare('system', state.contest.docId); await after.get('system', true, false);
        expect(Object.values(after.response.body.contest.group)).toContain('乙组');
    });
    it('保存时拒绝重名的手动分榜，以及与自动分榜同名的手动分榜', async () => {
        const app = setup(); await app.init(); const admin = app.settings(); admin.user.own = () => true;
        await admin.prepare('system', state.contest.docId);
        const post = (names: string[], extra = {}) => admin.post('system', JSON.stringify({ ...defaultSettings, ...extra,
            manualBoards: names.map((name, index) => ({ id: `b${index}`, name, teamIds: [] })) }));
        await expect(post(['新生榜', ' 新生榜'])).rejects.toThrow();
        await expect(post(['正式参赛'])).rejects.toThrow();
        await expect(post(['南京晓庄学院榜'])).rejects.toThrow();
        await post(['南京晓庄学院榜'], { schoolBoards: false });
        // Settings saved before the rule existed must still load.
        app.saved.set(`system/${state.contest.docId}`, { settings: { ...defaultSettings, manualBoards: [{ id: 'x', name: '同名', teamIds: [] }, { id: 'y', name: '同名', teamIds: [] }] } });
        await admin.get();
        expect(JSON.parse(admin.response.body.settingsJson).settings.manualBoards).toHaveLength(2);
    });
    it('题目颜色取自 Hydro 的气球颜色，未设置或无效时使用占位色', async () => {
        const { problemColor, UNSET_PROBLEM_COLOR } = await import('../lib/board');
        state.contest.pids = [100, 101, 102, 103];
        state.contest.balloon = { 100: { color: '#FF8800', name: '橙' }, 101: 'abc', 102: { color: 'not-a-colour', name: '' } };
        const colors = (await loadContestData(state.contest as Tdoc, false)).contest.balloon_color as { background_color: string }[];
        expect(colors.map((item) => item.background_color)).toEqual(['#ff8800', '#aabbcc', UNSET_PROBLEM_COLOR, UNSET_PROBLEM_COLOR]);
        expect(problemColor({ color: ' 1e90ff ' })).toBe('#1e90ff');
    });
    it('比赛进行中只有管理人员能看到提交页，结束后对所有人开放；榜单数据不含头像', async () => {
        const app = setup(); await app.init(); state.ended = false;
        const guest = app.publicBoard(); await guest.prepare('system', state.contest.docId); await guest.get('system');
        expect(guest.response.body.hideSubmissions).toBe(true);
        const owner = app.publicBoard(); owner.user.own = () => true;
        await owner.prepare('system', state.contest.docId); await owner.get('system');
        expect(owner.response.body.hideSubmissions).toBe(false);
        state.ended = true; await guest.get('system');
        expect(guest.response.body.hideSubmissions).toBe(false);
        const data = await loadContestData(state.contest as Tdoc, false, true);
        expect(data.teams[0].badge).toBeUndefined();
        expect(data.contest.badge).toBeUndefined();
    });
    it('普通参赛者不能修改设置或读取实时榜', async () => {
        const app = setup(); await app.init();
        const handler = app.settings();
        await expect(handler.prepare('system', state.contest.docId)).rejects.toThrow('Forbidden');
        await expect(app.view().display.call(handler, { tdoc: state.contest, realtime: true, json: true })).rejects.toThrow('Forbidden');
    });
    it('所有者可以保存设置，插件重新加载后仍然生效', async () => {
        const app = setup(); await app.init();
        const handler = app.settings(); handler.user.own = () => true;
        await handler.prepare('system', state.contest.docId);
        await handler.post('system', JSON.stringify({ ...defaultSettings, unofficialAwards: true, medals: { gold: 0, silver: 1, bronze: 0 }, manualBoards: [{ id: 'new', name: '新生榜', teamIds: ['1'] }] }));
        const restarted = setup(app.saved); await restarted.init();
        await restarted.view().display.call(handler, { tdoc: state.contest, realtime: false, json: true });
        expect(handler.response.body.contest.group['manual-new']).toBe('新生榜');
        expect(handler.response.body.contest.medal.all).toEqual({ gold: 0, silver: 1, bronze: 0 });
        expect(handler.response.addHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        const manager = restarted.settings(); manager.user.own = () => true;
        await manager.prepare('system', state.contest.docId); await manager.get();
        expect(JSON.parse(manager.response.body.settingsJson).settings.unofficialAwards).toBe(true);
    });
    it('同 ID 比赛在不同域中使用各自设置', async () => {
        const app = setup(); await app.init();
        const handler = app.settings(); handler.user.own = () => true;
        await handler.prepare('system', state.contest.docId);
        await handler.post('system', JSON.stringify({ ...defaultSettings, schoolBoards: false }));
        handler.domain._id = 'another';
        await handler.prepare('another', state.contest.docId);
        await handler.get();
        expect(JSON.parse(handler.response.body.settingsJson).settings.schoolBoards).toBe(true);
    });
    it('HTML 输出使用正确的刷新变量，并保留实时权限标识', async () => {
        const app = setup(); await app.init(); const handler = app.settings(); handler.user.own = () => true;
        await app.view().display.call(handler, { tdoc: state.contest, realtime: true, json: false });
        expect(JSON.parse(handler.response.body.runtimeJson).dataSource).toContain('realtime=true');
        expect(handler.response.body.realtime).toBe(true);
    });
});

describe('Hydro Resolver routes', () => {
    const tid = () => state.contest.docId;
    const config = JSON.stringify({ freezeMode: 'custom', freezeAtSeconds: 3000 });
    it('requires login and current ownership or edit permission, even with hidden-scoreboard permission', async () => {
        const app = setup(); await app.init();
        const anonymous = app.resolver(); anonymous.user._id = 0; anonymous.user.own = () => true;
        await expect(anonymous.prepare('system', tid())).rejects.toThrow('请登录');
        const viewer = app.resolver(); viewer.user.hasPerm = (perm: bigint) => perm === 2n;
        await expect(viewer.prepare('system', tid())).rejects.toThrow('Forbidden');
        const owner = app.resolver(); owner.user.own = () => true;
        await owner.prepare('spoofed', tid()); await owner.get();
        expect(JSON.parse(owner.response.body.runtimeJson).base).toBe(`/d/system/contest/${tid()}/resolver`);
        expect(owner.response.addHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        const editor = app.resolver(); editor.user.hasPerm = (perm: bigint) => perm === 1n;
        await editor.prepare('system', tid());
        state.contest.rule = 'oi';
        await expect(owner.prepare('system', tid())).rejects.toThrow('ACM');
    });
    it('captures final staff verdicts during rehearsal while public data stays masked', async () => {
        state.ended = false; state.locked = true;
        state.entries[0].journal = [record(state.contest.lockAt.getTime() / 1000 + 20, STATUS.STATUS_HACKED)];
        const app = setup(); await app.init(); const preview = app.resolver('_preview'); preview.user.own = () => true;
        await preview.prepare('system', tid()); await preview.post('system', config);
        expect(preview.response.body.config.rehearsal).toBe(true);
        expect((await preview.payload(config)).snapshot.submissions[0]).toMatchObject({ status: 'failed', penalty: true });
        expect([...app.resolverTables.values()].every((table) => table.size === 0)).toBe(true);
        expect((await loadContestData(state.contest, false)).submissions[0].status).toBe('FROZEN');
    });
    it('checks ownership, domain, revoked permissions and control token on every session request', async () => {
        const app = setup(); await app.init(); const creator = app.resolver('_sessions'); creator.user.own = () => true;
        await creator.prepare('system', tid()); await creator.post('system', config);
        const sid = creator.response.body.id;
        const play = app.resolver('_play'); play.user.own = () => true;
        await play.prepare('system', tid(), sid); await play.get();
        const token = JSON.parse(play.response.body.runtimeJson).controlToken;
        const other = app.resolver('_data'); other.user._id = 11; other.user.own = () => true;
        await expect(other.prepare('system', tid(), sid)).rejects.toThrow('不属于');
        const foreign = app.resolver('_data'); foreign.domain._id = 'foreign'; foreign.user.own = () => true;
        await expect(foreign.prepare('system', tid(), sid)).rejects.toThrow('不属于');
        const revoked = app.resolver('_data'); revoked.request.headers['x-resolver-control'] = token;
        await expect(revoked.prepare('system', tid(), sid)).rejects.toThrow('Forbidden');
        const data = app.resolver('_data'); data.user.own = () => true;
        await data.prepare('system', tid(), sid);
        await expect(data.get()).rejects.toThrow('令牌');
        data.request.headers['x-resolver-control'] = token;
        await data.get(); expect(data.response.body.steps.length).toBeGreaterThan(0);
        const list = app.resolver('_sessions'); list.user.own = () => true;
        await list.prepare('system', tid()); await list.get();
        expect(JSON.stringify(list.response.body)).not.toContain(token);
        const remove = app.resolver('_delete'); remove.user.own = () => true;
        await remove.prepare('system', tid(), sid); await remove.post();
        expect([...app.resolverTables.values()].every((table) => table.size === 0)).toBe(true);
    });
    it('only supplies the sidebar URL to managers of ACM contests', async () => {
        const app = setup(); await app.init();
        const hook = app.hooks.mock.calls.find(([name]: string[]) => name === 'handler/after')[1];
        const handler = app.resolver(); handler.UiContext = {}; handler.response.body = { tdoc: state.contest };
        hook(handler); expect(handler.UiContext.xcpcioResolverUrl).toBeUndefined();
        handler.user.own = () => true; hook(handler);
        expect(handler.UiContext.xcpcioResolverUrl).toContain(`/contest/${tid()}/resolver`);
    });
    it('inherits selected-board medal defaults for partial API configurations', async () => {
        const app = setup(); await app.init(); const settings = app.settings(); settings.user.own = () => true;
        await settings.prepare('system', tid());
        await settings.post('system', JSON.stringify({ ...defaultSettings, manualBoards: [{ id: 'one', name: '一组', teamIds: ['1'], medals: { gold: 4, silver: 3, bronze: 2 } }] }));
        const preview = app.resolver('_preview'); preview.user.own = () => true;
        await preview.prepare('system', tid());
        await preview.post('system', JSON.stringify({ boardId: 'manual-one' }));
        expect(preview.response.body.config).toMatchObject({ goldCount: 4, silverCount: 3, bronzeCount: 2 });
    });
});
