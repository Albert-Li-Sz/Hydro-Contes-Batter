/**
 * Queue, analytics and team spotlight services of ICPC Live v3 (backend service/*.kt, MIT),
 * ported to event callbacks.
 */
import type { ContestInfo, MediaType, QueueRunInfo, RunInfo, ScoreboardRow } from './types';
import type { Ranking } from './scoreboard';
import { ApiActionError } from './widgets';

type Listener = (event: unknown) => void;

/** ContestInfo.currentContestTime in milliseconds. */
export function currentContestTime(info: ContestInfo, now = Date.now()) {
    switch (info.status.type) {
    case 'before': return 0;
    case 'running': return (now - info.status.startedAtUnixMs) * info.emulationSpeed;
    default: return info.contestLengthMs;
    }
}

const isFirstToSolve = (run: RunInfo) => run.result.type === 'ICPC' && run.result.isFirstToSolveRun;

export class QueueService {
    private runs = new Map<string, RunInfo>();
    private removedRuns = new Map<string, RunInfo>();
    private lastUpdateTime = new Map<string, number>();
    private featured: { runId: string; media: MediaType[] } | null = null;
    private firstEventTime: number | null = null;
    private info: ContestInfo | null = null;
    private listeners = new Set<Listener>();

    private toQueueInfo(run: RunInfo): QueueRunInfo {
        return {
            id: run.id, result: run.result, problemId: run.problemId, teamId: run.teamId,
            featuredRunMedia: run.id === this.featured?.runId ? this.featured.media : null,
            reactionVideos: run.reactionVideos,
        };
    }

    private emit(event: unknown) { for (const listener of this.listeners) listener(event); }

    subscribe(listener: Listener) {
        listener({ type: 'QueueSnapshot', infos: [...this.runs.values()].sort((a, b) => a.time - b.time).map((run) => this.toQueueInfo(run)) });
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private modifyRun(run: RunInfo, send = true) {
        if (send) this.emit({ type: this.runs.has(run.id) ? 'ModifyRunInQueue' : 'AddRunToQueue', info: this.toQueueInfo(run) });
        this.runs.set(run.id, run);
    }

    private makeNotFeatured() {
        const featured = this.featured;
        if (!featured) return;
        const run = this.runs.get(featured.runId) || this.removedRuns.get(featured.runId);
        this.featured = null;
        if (run) this.modifyRun(run, this.runs.has(run.id));
    }

    private removeRun(run: RunInfo) {
        this.runs.delete(run.id);
        if (this.featured?.runId === run.id) this.makeNotFeatured();
        this.removedRuns.set(run.id, run);
        this.emit({ type: 'RemoveRunFromQueue', info: this.toQueueInfo(run) });
    }

    private timeInQueue(run: RunInfo, info: ContestInfo) {
        const settings = info.queueSettings;
        if (run.id === this.featured?.runId) return settings.featuredRunWaitTimeSeconds * 1000;
        if (isFirstToSolve(run)) return settings.firstToSolveWaitTimeSeconds * 1000;
        if (run.result.type === 'IN_PROGRESS') return settings.inProgressRunWaitTimeSeconds * 1000;
        return settings.waitTimeSeconds * 1000;
    }

    private isInProgress(run: RunInfo, info: ContestInfo) {
        return run.result.type === 'IN_PROGRESS' && info.freezeTimeMs !== null && run.time < info.freezeTimeMs;
    }

    private enforceSize() {
        const info = this.info;
        if (!info) return;
        while (this.runs.size >= info.queueSettings.maxQueueSize) {
            const candidates = [...this.runs.values()]
                .filter((run) => !isFirstToSolve(run) && run.id !== this.featured?.runId && !this.isInProgress(run, info));
            if (!candidates.length) break;
            this.removeRun(candidates.reduce((a, b) => (this.lastUpdateTime.get(a.id)! <= this.lastUpdateTime.get(b.id)! ? a : b)));
        }
    }

    onRun(run: RunInfo, info: ContestInfo, now = Date.now()) {
        if (info.status.type === 'before') return;
        this.info = info;
        this.removedRuns.set(run.id, run);
        const current = currentContestTime(info, now);
        if (this.firstEventTime === null) this.firstEventTime = current;
        // Runs loaded at start-up keep their own time, so the queue does not fill with history.
        const updateTime = current > this.firstEventTime + 60_000 ? current : run.time;
        this.lastUpdateTime.set(run.id, updateTime);
        if (run.isHidden) {
            if (this.runs.has(run.id)) this.removeRun(run);
        } else {
            let update: boolean;
            if (this.runs.has(run.id)) update = true;
            else if (this.isInProgress(run, info)
                && [...this.runs.values()].filter((item) => this.isInProgress(item, info)).length >= info.queueSettings.maxUntestedRun) update = false;
            else update = current <= updateTime + this.timeInQueue(run, info);
            if (update) this.modifyRun(run);
        }
        this.enforceSize();
    }

    clean(info: ContestInfo | null, now = Date.now()) {
        if (!info || !this.info) return;
        this.info = info;
        const current = currentContestTime(info, now);
        for (const run of [...this.runs.values()]) {
            if (run.id === this.featured?.runId) continue;
            if (current >= (this.lastUpdateTime.get(run.id) ?? run.time) + this.timeInQueue(run, info)) this.removeRun(run);
        }
        this.enforceSize();
    }

    feature(runId: string, media: MediaType[]) {
        const run = this.runs.get(runId) || this.removedRuns.get(runId);
        if (!run || !this.info) return null;
        this.makeNotFeatured();
        this.featured = { runId, media };
        this.modifyRun(run);
        this.lastUpdateTime.set(run.id, run.time);
        return { expirationTimeUnixMs: Date.now() + this.info.queueSettings.featuredRunWaitTimeSeconds * 1000, mediaType: media };
    }

    unfeature(runId: string) {
        if (this.featured?.runId !== runId) return;
        const run = this.runs.get(runId) || this.removedRuns.get(runId);
        this.featured = null;
        if (run) this.modifyRun(run, this.runs.has(runId));
    }
}

export interface AnalyticsTemplates {
    submittedRun: string;
    rejectedRun: string;
    firstToSolveRun: string;
    acceptedRun: string;
    acceptedWithSolvedProblemsRun: string;
}

export const chineseAnalyticsTemplates: AnalyticsTemplates = {
    submittedRun: '{team.shortName} 提交了 {problem.letter} 题',
    firstToSolveRun: '{team.shortName} 拿下 {problem.letter} 题一血！',
    rejectedRun: '{team.shortName} 的 {problem.letter} 题未通过（{run.result}）',
    acceptedRun: '{team.shortName} 通过 {problem.letter} 题，当前排名第 {result.rank}',
    acceptedWithSolvedProblemsRun: '{team.shortName} 通过 {problem.letter} 题，共通过 {result.solvedProblems} 题，当前排名第 {result.rank}',
};

interface Preset { presetId: number; expirationTimeUnixMs: number | null }
interface Comment {
    id: string;
    message: string;
    advertisement: Preset | null;
    tickerMessage: Preset | null;
    creationTimeUnixMs: number;
}
export interface AnalyticsMessage {
    id: string;
    updateTimeUnixMs: number;
    timeUnixMs: number;
    relativeTimeMs: number;
    comments: Comment[];
    teamId: string | null;
    runInfo: RunInfo | null;
    featuredRun: { expirationTimeUnixMs: number | null; mediaType: MediaType[] } | null;
    tags: string[];
}

export interface AnalyticsCompanions {
    showAdvertisement: (text: string, ttlMs: number, onExpire: (presetId: number) => void) => number;
    hideAdvertisement: (presetId: number) => void;
    showTicker: (text: string, ttlMs: number, onExpire: (presetId: number) => void) => number;
    hideTicker: (presetId: number) => void;
    feature: (run: RunInfo, mediaType: string) => AnalyticsMessage['featuredRun'];
    unfeature: (run: RunInfo) => void;
}

/** AnalyticsGenerator + AnalyticsService: one message per run, with a generated comment. */
export class AnalyticsService {
    private messages = new Map<string, AnalyticsMessage>();
    private analyses = new Map<string, { creationTime: number; rank: number; awards: string[] }>();
    private listeners = new Set<Listener>();

    constructor(private templates: AnalyticsTemplates, private companions: AnalyticsCompanions) {}

    subscribe(listener: Listener) {
        listener({ type: 'AnalyticsMessageSnapshot', messages: this.list() });
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    list() { return [...this.messages.values()].sort((a, b) => a.relativeTimeMs - b.relativeTimeMs); }

    private store(message: AnalyticsMessage) {
        this.messages.set(message.id, message);
        for (const listener of this.listeners) listener({ type: 'UpdateAnalyticsMessage', message });
    }

    private commentary(run: RunInfo, info: ContestInfo, rows: Map<string, ScoreboardRow>, ranking: Ranking) {
        const row = rows.get(run.teamId);
        const index = ranking.order.indexOf(run.teamId);
        if (!row || index < 0) {
            this.analyses.delete(run.id);
            return null;
        }
        let analysis = this.analyses.get(run.id);
        if (!analysis) {
            analysis = {
                creationTime: Date.now(), rank: ranking.ranks[index],
                awards: ranking.awards.filter((award) => award.teams.includes(run.teamId)).map((award) => award.id),
            };
            this.analyses.set(run.id, analysis);
        }
        const team = info.teams.find((item) => item.id === run.teamId);
        const problem = info.problems.find((item) => item.id === run.problemId);
        if (!team || !problem) return null;
        const solved = row.problemResults.filter((result) => result.isSolved).length;
        const substitute: Record<string, string> = {
            '{team.shortName}': team.shortName,
            '{problem.letter}': problem.letter,
            '{problem.name}': problem.name,
            '{run.result}': run.result.type === 'ICPC' ? run.result.verdict.shortName : '',
            '{result.rank}': String(analysis.rank || '*'),
            '{result.solvedProblems}': solved > 0 ? String(solved) : '',
        };
        let template: string;
        const tags: string[] = [];
        if (run.result.type === 'IN_PROGRESS') {
            template = this.templates.submittedRun;
            tags.push('submission', ...analysis.awards.map((id) => `submission-${id}`));
        } else if (!run.result.verdict.isAccepted) {
            template = this.templates.rejectedRun;
            tags.push('rejected');
        } else {
            template = run.result.isFirstToSolveRun ? this.templates.firstToSolveRun
                : substitute['{result.solvedProblems}'] ? this.templates.acceptedWithSolvedProblemsRun : this.templates.acceptedRun;
            tags.push('accepted', ...(run.result.isFirstToSolveRun ? ['accepted-first-to-solve'] : []), ...analysis.awards.map((id) => `accepted-${id}`));
        }
        const message = Object.entries(substitute).reduce((result, [key, value]) => result.split(key).join(value), template);
        return { id: `_analytics_by_run_${run.id}`, message, time: analysis.creationTime, tags };
    }

    onRun(run: RunInfo, info: ContestInfo, rows: Map<string, ScoreboardRow>, ranking: Ranking) {
        if (run.isHidden) return;
        const start = info.status.type === 'before' ? info.status.scheduledStartAtUnixMs ?? 0 : info.status.startedAtUnixMs;
        const time = start + run.time / info.emulationSpeed;
        let message = this.messages.get(run.id) || {
            id: run.id, updateTimeUnixMs: time, timeUnixMs: time, relativeTimeMs: run.time,
            comments: [], teamId: null, runInfo: null, featuredRun: null, tags: [],
        };
        const tags = new Set(message.tags);
        tags.add('submission');
        if (run.result.type === 'ICPC' && run.result.verdict.isAccepted) tags.add('accepted');
        if (run.result.type === 'ICPC' && run.result.isFirstToSolveRun) tags.add('first-to-solved');
        message = { ...message, teamId: run.teamId, runInfo: run, timeUnixMs: time, relativeTimeMs: run.time,
            updateTimeUnixMs: Math.max(message.updateTimeUnixMs, time), tags: [...tags] };
        this.store(message);
        const comment = this.commentary(run, info, rows, ranking);
        if (!comment) return;
        const existing = message.comments.find((item) => item.id === comment.id);
        const updated: Comment = { id: comment.id, message: comment.message, advertisement: existing?.advertisement ?? null,
            tickerMessage: existing?.tickerMessage ?? null, creationTimeUnixMs: comment.time };
        this.store({
            ...message,
            updateTimeUnixMs: Math.max(message.updateTimeUnixMs, comment.time),
            comments: [...message.comments.filter((item) => item.id !== comment.id), updated].sort((a, b) => b.creationTimeUnixMs - a.creationTimeUnixMs),
            tags: [...new Set([...message.tags, ...comment.tags])],
        });
    }

    private updateComment(messageId: string, commentId: string, change: (comment: Comment) => Comment) {
        const message = this.messages.get(messageId);
        if (!message) throw new ApiActionError(`AnalyticsMessage with id ${messageId} not found`);
        const comment = message.comments.find((item) => item.id === commentId);
        if (!comment) throw new ApiActionError(`AnalyticsMessageCommentary with id ${commentId} not found`);
        const updated = change(comment);
        this.store({ ...message, comments: message.comments.map((item) => (item.id === commentId ? updated : item)) });
    }

    showAdvertisement(messageId: string, commentId: string, ttlMs: number) {
        this.updateComment(messageId, commentId, (comment) => {
            if (comment.advertisement) this.companions.hideAdvertisement(comment.advertisement.presetId);
            const presetId = this.companions.showAdvertisement(comment.message, ttlMs, (expired) => {
                this.updateComment(messageId, commentId, (current) => (current.advertisement?.presetId === expired ? { ...current, advertisement: null } : current));
            });
            return { ...comment, advertisement: { presetId, expirationTimeUnixMs: Date.now() + ttlMs } };
        });
    }

    hideAdvertisement(messageId: string, commentId: string) {
        this.updateComment(messageId, commentId, (comment) => {
            if (comment.advertisement) this.companions.hideAdvertisement(comment.advertisement.presetId);
            return { ...comment, advertisement: null };
        });
    }

    showTicker(messageId: string, commentId: string, ttlMs: number) {
        this.updateComment(messageId, commentId, (comment) => {
            if (comment.tickerMessage) this.companions.hideTicker(comment.tickerMessage.presetId);
            const presetId = this.companions.showTicker(comment.message, ttlMs, (expired) => {
                this.updateComment(messageId, commentId, (current) => (current.tickerMessage?.presetId === expired ? { ...current, tickerMessage: null } : current));
            });
            return { ...comment, tickerMessage: { presetId, expirationTimeUnixMs: Date.now() + ttlMs } };
        });
    }

    hideTicker(messageId: string, commentId: string) {
        this.updateComment(messageId, commentId, (comment) => {
            if (comment.tickerMessage) this.companions.hideTicker(comment.tickerMessage.presetId);
            return { ...comment, tickerMessage: null };
        });
    }

    makeFeatured(messageId: string, mediaType: string) {
        const message = this.messages.get(messageId);
        if (!message?.runInfo) throw new ApiActionError(`Can't make run featured caused by message ${messageId}`);
        const featuredRun = this.companions.feature(message.runInfo, mediaType);
        if (!featuredRun) throw new ApiActionError(`Can't make run ${message.runInfo.id} featured: the team has no ${mediaType} media`);
        this.store({ ...message, featuredRun });
    }

    makeNotFeatured(messageId: string) {
        const message = this.messages.get(messageId);
        if (!message?.runInfo) throw new ApiActionError(`Can't make run not featured caused by message ${messageId}`);
        this.companions.unfeature(message.runInfo);
        this.store({ ...message, featuredRun: null });
    }
}

/** TeamSpotlightFlowSettings defaults. */
const spotlight = {
    notJudgedRunScore: 5, judgedRunScore: 10, acceptedRunScore: 5, firstToSolvedRunScore: 5,
    scoreboardPushIntervalMs: 180_000, scoreboardLowestRank: 40, scoreboardFirstScore: 5, scoreboardLastScore: 1,
    scoreboardBeforeContestScore: 2, socialEventScore: 100, externalScoreScale: 1,
};

/** TeamSpotlightService: picks the next team to follow when a team view has no team set. */
export class SpotlightService {
    private scores = new Map<string, number>();
    private runIds = new Set<string>();
    private listeners = new Set<() => void>();

    onChange(listener: () => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private add(teamId: string, delta: number) {
        this.scores.set(teamId, (this.scores.get(teamId) || 0) + delta);
        for (const listener of this.listeners) listener();
    }

    score(teamId: string) { return this.scores.get(teamId) || 0; }

    onRun(run: RunInfo, info: ContestInfo, now = Date.now()) {
        if (run.isHidden || run.time + 60_000 <= currentContestTime(info, now)) return;
        const judged = run.result.type === 'ICPC';
        if (!judged && this.runIds.has(run.id)) return;
        this.runIds.add(run.id);
        let delta = 0;
        if (run.result.type === 'ICPC') {
            const fts = run.result.isFirstToSolveRun;
            if (fts) delta += spotlight.firstToSolvedRunScore;
            if (run.result.verdict.isAccepted) delta += spotlight.acceptedRunScore;
            // Upstream adds the judged-run score only for first solves (TeamSpotlightService.kt).
            if (fts) delta += spotlight.judgedRunScore;
        } else delta += spotlight.notJudgedRunScore;
        this.add(run.teamId, delta);
    }

    pushScoreboard(ranking: Ranking, info: ContestInfo) {
        ranking.order.forEach((teamId, index) => {
            const rank = ranking.ranks[index];
            if (rank > spotlight.scoreboardLowestRank) return;
            let score: number;
            if (info.status.type === 'before') score = spotlight.scoreboardBeforeContestScore;
            else score = spotlight.scoreboardLastScore + (spotlight.scoreboardLowestRank - rank)
                * (spotlight.scoreboardFirstScore - spotlight.scoreboardLastScore) / (spotlight.scoreboardLowestRank - 1);
            if (rank > 0) this.add(teamId, score);
        });
    }

    addScore(teamId: string, score: number) { this.add(teamId, spotlight.externalScoreScale * score); }
    social(teamIds: string[]) { for (const teamId of teamIds) this.add(teamId, spotlight.socialEventScore); }

    /** The most interesting team, removed from the queue (it re-enters with new events). */
    next(info: ContestInfo): string | null {
        const visible = new Set(info.teams.filter((team) => !team.isHidden).map((team) => team.id));
        let best: string | null = null;
        for (const [teamId, score] of this.scores) {
            if (!visible.has(teamId)) continue;
            if (best === null || score > this.scores.get(best)! || (score === this.scores.get(best)! && teamId < best)) best = teamId;
        }
        if (best !== null) {
            this.scores.delete(best);
            for (const listener of this.listeners) listener();
        }
        return best;
    }

    get pushInterval() { return spotlight.scoreboardPushIntervalMs; }
}
