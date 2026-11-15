/**
 * One contest's ICPC Live backend: the DataBus, services and controllers of ICPC Live v3
 * (backend Application.kt / ServiceRoot.kt / Controllers.kt, MIT) in one Node object.
 */
import { buildContestInfo, buildRuns, type LiveSource } from './model';
import {
    computeScoreboard, runsByTeam, scoreboardDiff, statistics, timeline, type ScoreboardState,
} from './scoreboard';
import { AnalyticsService, chineseAnalyticsTemplates, QueueService, SpotlightService } from './services';
import type { ContestInfo, OptimismLevel, RunInfo, TeamInfo } from './types';
import { optimismLevels } from './types';
import {
    ApiActionError, generateId, PresetsController, ShowOrderCounter, TickerManager, type TickerMessage, type Widget,
    WidgetController, WidgetManager, type WidgetState,
} from './widgets';
import * as S from './widget-settings';

type Listener = (payload: unknown) => void;

export interface LiveState {
    controllers?: Record<string, WidgetState<unknown>>;
    presets?: Record<string, WidgetState<unknown>[]>;
}

export interface HubDependencies {
    load: () => Promise<LiveSource | null>;
    persist: (state: LiveState) => Promise<void>;
    /** SVG title templates by media name. */
    template: (name: string) => Promise<string | null>;
    intervalMs?: number;
    idleMs?: number;
}

const camel = (position: string) => position.split('_').map((part) => part[0] + part.slice(1).toLowerCase()).join('');

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** TemplateSubstitutorImpl: `{a.b}` is replaced escaped, `{!a.b}` raw, unknown keys stay. */
export function substituteTemplate(template: string, data: Record<string, unknown>, sanitize: (value: string) => string = escapeHtml) {
    const lookup = (key: string) => {
        let value: unknown = data;
        for (const part of key.split('.')) {
            if (Array.isArray(value)) value = value[Number(part)];
            else if (value && typeof value === 'object') value = (value as Record<string, unknown>)[part];
            else return null;
            if (value === undefined) return null;
        }
        if (value === null || value === undefined) return null;
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    };
    return template.replace(/\{(!?[a-z0-9A-Z_.-]*)}/g, (match, key: string) => {
        if (key.startsWith('!')) return lookup(key.slice(1)) ?? match;
        const value = lookup(key);
        return value === null ? match : sanitize(value);
    });
}

const tickerPrefix: Record<string, string> = {
    clock: 'ticker_clock', empty: 'ticker_empty', image: 'ticker_image', scoreboard: 'ticker_scoreboard', text: 'ticker_text',
};

export class LiveHub {
    info: ContestInfo | null = null;
    private infoJson = '';
    private runs = new Map<string, RunInfo>();
    private byTeam = new Map<string, RunInfo[]>();
    private scoreboards = new Map<OptimismLevel, ScoreboardState>();
    private statisticsJson = '';
    private timelines = new Map<string, string>();
    private channels = new Map<string, Set<Listener>>();
    private logLines: string[] = [];
    private templates = new Map<string, string>();
    private spotTeams = new Map<string, string | null>();

    readonly widgets = new WidgetManager();
    readonly ticker = new TickerManager();
    private counter = new ShowOrderCounter();
    readonly queueService = new QueueService();
    readonly spotlight = new SpotlightService();
    readonly analytics: AnalyticsService;

    readonly controllers: Record<string, WidgetController<any, Widget>> = {};
    readonly teamViews: Record<S.TeamViewPosition, WidgetController<ReturnType<ReturnType<typeof S.teamViewSettings>>, Widget>>;
    readonly advertisement: PresetsController<ReturnType<typeof S.advertisementSettings>, Widget>;
    readonly picture: PresetsController<ReturnType<typeof S.pictureSettings>, Widget>;
    readonly title: PresetsController<ReturnType<typeof S.titleSettings>, Widget>;
    readonly tickerMessage: PresetsController<ReturnType<typeof S.tickerMessageSettings>, TickerMessage>;

    private timer: NodeJS.Timeout | null = null;
    private cleaner: NodeJS.Timeout | null = null;
    private spotlightTimer: NodeJS.Timeout | null = null;
    private rotationTimer: NodeJS.Timeout | null = null;
    private saveTimer: NodeJS.Timeout | null = null;
    private lastActivity = 0;
    private refreshing: Promise<void> | null = null;
    private disposed = false;
    readonly ready: Promise<void>;

    constructor(private deps: HubDependencies, state: LiveState = {}) {
        const changed = () => this.scheduleSave();
        const single = <T>(name: string, defaults: T, normalize: (input: unknown) => T, construct: (settings: T) => Widget | null, dynamic = false) => {
            const controller = new WidgetController<T, Widget>(defaults, this.widgets, this.counter, construct, (input) => normalize(input), changed, null, dynamic);
            this.controllers[name] = controller;
            return controller;
        };
        const fixed = (type: string, id: string) => (settings: unknown): Widget => ({ type, id, widgetLocationId: id, statisticsId: id, settings });
        single('queue', S.queueSettings({}), S.queueSettings, fixed('QueueWidget', 'queue'));
        single('statistics', {}, S.emptySettings, fixed('StatisticsWidget', 'statistics'));
        single('ticker', {}, S.emptySettings, fixed('TickerWidget', 'ticker'));
        single('scoreboard', S.scoreboardSettings({}), S.scoreboardSettings, fixed('ScoreboardWidget', 'scoreboard'));
        single('fullScreenClock', S.clockSettings({}), S.clockSettings, fixed('FullScreenClockWidget', 'fullScreenClock'));
        single('teamLocator', S.locatorSettings({}), S.locatorSettings, (settings) => {
            const teams = new Set(this.info?.teams.map((team) => team.id) || []);
            return fixed('TeamLocatorWidget', 'teamLocator')({
                circles: settings.circles.filter((circle) => circle.teamId && teams.has(circle.teamId)),
                scene: settings.scene,
            });
        }, true);
        const teamViews = {} as typeof this.teamViews;
        for (const position of S.teamViewPositions) {
            const normalize = S.teamViewSettings(position);
            teamViews[position] = single(`teamView/${position}`, normalize({}), normalize, (settings) => this.teamViewWidget(position, settings), true);
        }
        this.teamViews = teamViews;
        const preset = <T>(normalize: (input: unknown) => T, construct: (settings: T) => Widget | null) =>
            new PresetsController<T, Widget>(this.widgets, this.counter, construct, (input) => normalize(input), changed);
        this.advertisement = preset(S.advertisementSettings, (advertisement) => {
            const id = generateId('advertisement');
            return { type: 'AdvertisementWidget', id, widgetLocationId: 'advertisement', statisticsId: 'advertisement', advertisement };
        });
        this.picture = preset(S.pictureSettings, (picture) => {
            const id = generateId('picture');
            return { type: 'PictureWidget', id, widgetLocationId: 'picture', statisticsId: 'picture', picture };
        });
        this.title = preset(S.titleSettings, (settings) => {
            const template = this.templates.get(settings.preset);
            if (template === undefined) throw new ApiActionError(`Title template ${settings.preset} is not loaded`);
            const content = `data: image/svg+xml; utf8; base64,${Buffer.from(this.renderTitle(template, settings.data)).toString('base64')}`;
            return { type: 'SvgWidget', id: generateId('svg'), widgetLocationId: 'svg', statisticsId: 'svg', content };
        });
        this.tickerMessage = new PresetsController(this.ticker, this.counter,
            (settings) => ({ id: generateId(tickerPrefix[settings.type]), settings }),
            (input) => S.tickerMessageSettings(input), changed);
        this.analytics = new AnalyticsService(chineseAnalyticsTemplates, {
            showAdvertisement: (text, ttl, onExpire) => {
                const id = this.advertisement.createTemporary({ text }, ttl, onExpire);
                this.advertisement.show(id);
                return id;
            },
            hideAdvertisement: (id) => { try { this.advertisement.hide(id); } catch { /* already gone */ } },
            showTicker: (text, ttl, onExpire) => {
                const id = this.tickerMessage.createTemporary({ type: 'text', part: 'long', periodMs: 30_000, text }, ttl, onExpire);
                this.tickerMessage.show(id);
                return id;
            },
            hideTicker: (id) => { try { this.tickerMessage.hide(id); } catch { /* already gone */ } },
            feature: (run, mediaType) => {
                const media = this.info?.teams.find((team) => team.id === run.teamId)?.medias[mediaType] || [];
                return media.length ? this.queueService.feature(run.id, media) : null;
            },
            unfeature: (run) => this.queueService.unfeature(run.id),
        });
        this.queueService.subscribe((event) => this.publish('queue', event));
        this.spotlight.onChange(() => this.publishInteresting());
        this.ready = this.restore(state);
    }

    private async restore(state: LiveState) {
        const titles = Array.isArray(state.presets?.title) ? state.presets!.title : [];
        for (const item of titles) {
            const name = (item?.settings as { preset?: unknown } | undefined)?.preset;
            if (typeof name === 'string') await this.loadTemplate(name).catch(() => null);
        }
        for (const [name, controller] of Object.entries(this.controllers)) controller.load(state.controllers?.[name]);
        this.advertisement.load(state.presets?.advertisement);
        this.picture.load(state.presets?.picture);
        this.title.load(titles);
        this.tickerMessage.load(state.presets?.tickerMessage);
    }

    async loadTemplate(name: string) {
        if (this.templates.has(name)) return;
        const template = await this.deps.template(name);
        if (template === null) throw new ApiActionError(`No title template named ${name}`);
        this.templates.set(name, template);
    }

    forgetTemplate(name: string) { this.templates.delete(name); }

    private renderTitle(template: string, data: Record<string, string>) {
        const values: Record<string, unknown> = { ...data };
        const team = data.teamId ? this.info?.teams.find((item) => item.id === data.teamId) : undefined;
        const org = (id?: string | null) => (id ? this.info?.organizations.find((item) => item.id === id) : undefined);
        if (team) {
            values.team = { ...team, fullName: team.name, displayName: team.shortName };
            if (org(team.organizationId)) values.org = org(team.organizationId);
        }
        if (data.organizationId && org(data.organizationId)) values.org = org(data.organizationId);
        return substituteTemplate(template, values);
    }

    private teamViewWidget(position: S.TeamViewPosition, settings: ReturnType<ReturnType<typeof S.teamViewSettings>>): Widget | null {
        const info = this.info;
        if (!info) return null;
        const teamId = settings.teamId ?? this.spotTeam(position);
        const team = teamId ? info.teams.find((item) => item.id === teamId) : undefined;
        if (!team) return null;
        const content = settings.mediaTypes.map((type) => team.medias[type]).filter(Boolean);
        const id = `teamView${camel(position)}`;
        return {
            type: 'TeamViewWidget', id, widgetLocationId: id, statisticsId: 'teamView',
            settings: {
                teamId: team.id, primary: content[0] || [], secondary: content[1] || [], showTaskStatus: settings.showTaskStatus,
                achievement: settings.showAchievement ? team.medias.achievement || [] : [], showTimeLine: settings.showTimeLine, position,
            },
        };
    }

    // ---- persistence -------------------------------------------------------------------

    private scheduleSave() {
        if (this.saveTimer || this.disposed) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.deps.persist(this.state()).catch((error) => this.log(`保存直播控件状态失败：${error?.message || error}`));
        }, 500);
        this.saveTimer.unref?.();
    }

    state(): LiveState {
        return {
            controllers: Object.fromEntries(Object.entries(this.controllers).map(([name, controller]) => [name, controller.persistentState])),
            presets: {
                advertisement: this.advertisement.persistentState,
                picture: this.picture.persistentState,
                title: this.title.persistentState,
                tickerMessage: this.tickerMessage.persistentState,
            },
        };
    }

    // ---- channels ----------------------------------------------------------------------

    private publish(channel: string, payload: unknown) {
        const listeners = this.channels.get(channel);
        if (!listeners) return;
        for (const listener of listeners) listener(payload);
    }

    private interestingTeams() {
        return (this.info?.teams || []).map((team: TeamInfo) => ({ teamId: team.id, teamName: team.name, score: this.spotlight.score(team.id) }));
    }

    private interestingQueued = false;
    private publishInteresting() {
        if (this.interestingQueued || !this.channels.get('teamSpotlight')?.size) return;
        this.interestingQueued = true;
        setTimeout(() => {
            this.interestingQueued = false;
            this.publish('teamSpotlight', this.interestingTeams());
        }, 500).unref?.();
    }

    /** First value of a channel, for the plain-HTTP variants of the flow endpoints. */
    current(channel: string): unknown {
        const [name, argument] = channel.split(':');
        switch (name) {
        case 'contestInfo': return this.info;
        case 'runs': return [...this.runs.values()].sort((a, b) => a.time - b.time);
        case 'teamRuns': return timeline(this.byTeam.get(argument) || []);
        case 'statistics': return this.info && this.scoreboards.get('normal') ? statistics(this.info, this.scoreboards.get('normal')!) : { type: 'ICPC', teamsCount: 0, stats: [] };
        case 'scoreboard': {
            const state = this.scoreboards.get(argument as OptimismLevel);
            return state ? scoreboardDiff(state) : { rows: {}, order: [], ranks: [], awards: [] };
        }
        case 'teamSpotlight': return this.interestingTeams();
        case 'analytics': return this.analytics.list();
        default: return null;
        }
    }

    /** Subscribe to a channel; the listener first receives what a new subscriber upstream gets. */
    subscribe(channel: string, listener: Listener) {
        this.touch();
        let unsubscribe: () => void;
        const [name] = channel.split(':');
        if (name === 'mainScreen') unsubscribe = this.widgets.subscribe(listener);
        else if (name === 'ticker') unsubscribe = this.ticker.subscribe(listener);
        else if (name === 'queue') unsubscribe = this.queueService.subscribe(listener);
        else if (name === 'analytics') unsubscribe = this.analytics.subscribe(listener);
        else {
            if (name === 'backendLog') for (const line of this.logLines) listener(line);
            else if (!['adminActions', 'social'].includes(name)) {
                const value = this.current(channel);
                if (value !== null) listener(value);
            }
            let listeners = this.channels.get(channel);
            if (!listeners) this.channels.set(channel, listeners = new Set());
            listeners.add(listener);
            unsubscribe = () => listeners!.delete(listener);
        }
        this.subscribers++;
        let done = false;
        return () => {
            if (done) return;
            done = true;
            this.subscribers--;
            unsubscribe();
            if (this.channels.get(channel)?.size === 0) this.channels.delete(channel);
            this.lastActivity = Date.now();
        };
    }

    private subscribers = 0;

    /** How long nobody has watched or used this contest's live module. */
    idleFor(now = Date.now()) { return this.subscribers ? 0 : now - this.lastActivity; }

    log(line: string) {
        const entry = `${new Date().toISOString()} ${line}`;
        this.logLines.push(entry);
        if (this.logLines.length > 500) this.logLines.shift();
        this.publish('backendLog', entry);
    }

    adminAction(uri: string, user: string) {
        this.log(`Changing request ${uri} is done by ${user}`);
        this.publish('adminActions', uri);
    }

    social(message: { chatmessage: string; chatname: string; type: string; teamIds: string[] }) {
        this.spotlight.social(message.teamIds);
        this.publish('social', message);
    }

    // ---- data --------------------------------------------------------------------------

    /** Keep polling while someone watches, and for a while after the last request. */
    touch() {
        this.lastActivity = Date.now();
        if (!this.timer && !this.disposed) this.loop();
    }

    private loop() {
        const interval = this.deps.intervalMs ?? 2000;
        const tick = async () => {
            this.timer = null;
            if (this.disposed) return;
            if (!this.subscribers && Date.now() - this.lastActivity > (this.deps.idleMs ?? 60_000)) {
                this.stopTimers();
                return;
            }
            await this.refresh().catch((error) => this.log(`读取比赛数据失败：${error?.message || error}`));
            if (!this.disposed) {
                this.timer = setTimeout(tick, interval);
                this.timer.unref?.();
            }
        };
        this.timer = setTimeout(tick, 0);
        this.timer.unref?.();
        if (!this.cleaner) {
            this.cleaner = setInterval(() => this.queueService.clean(this.info), 1000);
            this.cleaner.unref?.();
        }
        if (!this.spotlightTimer) {
            this.spotlightTimer = setInterval(() => {
                const state = this.scoreboards.get('normal');
                if (state && this.info) this.spotlight.pushScoreboard(state.ranking, this.info);
            }, this.spotlight.pushInterval);
            this.spotlightTimer.unref?.();
        }
        if (!this.rotationTimer) {
            // TeamViewController: a view without a team follows the spotlight, one team per 30 seconds.
            this.rotationTimer = setInterval(() => this.rotateSpotlight(), 30_000);
            this.rotationTimer.unref?.();
        }
    }

    private rotateSpotlight() {
        if (!this.info) return;
        for (const position of S.teamViewPositions) {
            const controller = this.teamViews[position];
            if (!controller.shown || controller.settings.teamId) continue;
            const next = this.spotlight.next(this.info);
            if (next) this.spotTeams.set(position, next);
            controller.sync();
        }
    }

    /** The team a view without its own team follows, picked on first use. */
    private spotTeam(position: S.TeamViewPosition) {
        let teamId = this.spotTeams.get(position) ?? null;
        if (!teamId && this.info) {
            teamId = this.spotlight.next(this.info) ?? this.info.teams[0]?.id ?? null;
            this.spotTeams.set(position, teamId);
        }
        return teamId;
    }

    private stopTimers() {
        for (const timer of [this.cleaner, this.spotlightTimer, this.rotationTimer]) if (timer) clearInterval(timer);
        this.cleaner = this.spotlightTimer = this.rotationTimer = null;
    }

    /** Load, diff and publish. Concurrent callers share one load. */
    refresh() {
        this.refreshing ||= this.doRefresh().finally(() => { this.refreshing = null; });
        return this.refreshing;
    }

    private async doRefresh() {
        await this.ready;
        const source = await this.deps.load();
        if (!source || this.disposed) return;
        this.apply(source);
    }

    /** Apply one snapshot of the contest (exposed for tests). */
    apply(source: LiveSource) {
        const info = buildContestInfo(source);
        const runs = buildRuns(source, info);
        const infoJson = JSON.stringify(info);
        const infoChanged = infoJson !== this.infoJson;
        if (infoChanged) {
            this.info = info;
            this.infoJson = infoJson;
            this.publish('contestInfo', info);
        }
        const next = new Map(runs.map((run) => [run.id, run]));
        const changed = runs.filter((run) => JSON.stringify(this.runs.get(run.id)) !== JSON.stringify(run));
        const removed = [...this.runs.values()].filter((run) => !next.has(run.id)).map((run) => ({ ...run, isHidden: true }));
        this.runs = next;
        this.byTeam = runsByTeam(runs);
        if (!changed.length && !removed.length && !infoChanged && this.scoreboards.size) return;
        for (const level of optimismLevels) {
            const previous = this.scoreboards.get(level);
            const state = computeScoreboard(info, this.byTeam, level);
            this.scoreboards.set(level, state);
            const diff = scoreboardDiff(state, previous);
            if (!previous || Object.keys(diff.rows).length || JSON.stringify(previous.ranking) !== JSON.stringify(state.ranking)) {
                this.publish(`scoreboard:${level}`, diff);
            }
        }
        const normal = this.scoreboards.get('normal')!;
        for (const run of [...removed, ...changed]) {
            this.queueService.onRun(run, info);
            this.spotlight.onRun(run, info);
            if (!run.isHidden) this.analytics.onRun(run, info, normal.rows, normal.ranking);
        }
        const stats = statistics(info, normal);
        const statsJson = JSON.stringify(stats);
        if (statsJson !== this.statisticsJson) {
            this.statisticsJson = statsJson;
            this.publish('statistics', stats);
        }
        if (changed.length || removed.length) this.publish('runs', this.current('runs'));
        for (const [channel] of this.channels) {
            if (!channel.startsWith('teamRuns:')) continue;
            const value = JSON.stringify(this.current(channel));
            if (this.timelines.get(channel) !== value) {
                this.timelines.set(channel, value);
                this.publish(channel, JSON.parse(value));
            }
        }
        if (infoChanged) {
            for (const controller of Object.values(this.controllers)) controller.sync();
            this.publishInteresting();
        }
    }

    regions() {
        const used = new Set(this.info?.teams.flatMap((team) => team.groups) || []);
        return (this.info?.groups || []).filter((group) => used.has(group.id));
    }

    teams() { return (this.info?.teams || []).filter((team) => !team.isHidden); }

    usageStatistics() { return this.widgets.usageStatistics(); }

    dispose() {
        this.disposed = true;
        if (this.timer) clearTimeout(this.timer);
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.deps.persist(this.state()).catch(() => null);
        }
        this.stopTimers();
        for (const presets of [this.advertisement, this.picture, this.title, this.tickerMessage]) presets.dispose();
        this.channels.clear();
    }
}
