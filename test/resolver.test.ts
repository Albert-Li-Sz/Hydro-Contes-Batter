import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { demoData } from './fixture';
import { defaultSettings } from '../lib/settings';
import { defaultResolverConfig, parseResolverConfig, prepareResolver, resolverBoards } from '../lib/resolver-data';
import { computeCells } from '../resolver/server/lib/engine.js';
import { ResolverSessions, resolverChunkBytes } from '../lib/resolver-sessions';
import { previewDatabase } from '../preview/resolver-memory-db';

it('keeps the bundled school crest at source resolution for award presentations', () => {
    const registry = JSON.parse(readFileSync(new URL('../logos/index.json', import.meta.url), 'utf8'));
    expect(registry.resolution).toBe('original');
    const id = registry.names['南京晓庄学院'];
    const image = readFileSync(new URL(`../logos/${id}.webp`, import.meta.url));
    // This registry source is a lossless 1024px WebP. Guard against the old
    // asset pipeline silently shrinking it to a 96px thumbnail again.
    expect(image.subarray(12, 16).toString()).toBe('VP8L');
    const dimensions = image.readUInt32LE(21);
    expect((dimensions & 0x3fff) + 1).toBeGreaterThanOrEqual(1024);
    expect(((dimensions >>> 14) & 0x3fff) + 1).toBeGreaterThanOrEqual(1024);
    const hash = createHash('sha256').update(image).digest('hex');
    expect(hash).toBe(registry.images[id].sourceSha256);
    expect(hash).toBe(registry.images[id].sha256);
});

const settings = {
    ...defaultSettings, showIdentity: true, unofficialAwards: true,
    manualBoards: [{ id: 'mixed', name: '混合榜', teamIds: ['1', '4', '7'], medals: { gold: 2, silver: 0, bronze: 1 } }],
};
const context = { contestId: 'contest-a', ended: true, capturedAt: new Date('2026-11-14T00:00:00Z'), logoNames: {} };
const config = { ...defaultResolverConfig(settings, true), freezeMode: 'custom' as const, freezeAtSeconds: 2000 };
function prepare(overrides = {}, data = demoData(), env = context) {
    return prepareResolver(data, resolverBoards(data, settings, true), { ...config, ...overrides }, env);
}

describe('Resolver Hydro data adapter', () => {
    it('retains only selected members and preserves starred identity', () => {
        const payload = prepare({ boardId: 'manual-mixed' });
        expect(payload.snapshot.teams.map((team) => team.id)).toEqual(['1', '4', '7']);
        expect(payload.snapshot.teams.find((team) => team.id === '4')?.unrank).toBe(true);
        expect(payload.snapshot.submissions.every((record) => ['1', '4', '7'].includes(record.teamId))).toBe(true);
    });
    it('keeps every team while only original official members of a board rank and receive awards', () => {
        const data = demoData();
        const before = structuredClone(data);
        const payload = prepare({ mode: 'official', boardId: 'manual-mixed', firstSolve: true, podiumEnabled: true }, data);
        expect(payload.snapshot.teams.filter((team) => !team.unrank).map((team) => team.id)).toEqual(['1', '7']);
        expect(payload.snapshot.teams).toHaveLength(8);
        const awards = payload.game.contest.awards as { teamIds: string[] }[];
        expect(awards.length).toBeGreaterThan(0);
        expect(awards.every((award) => award.teamIds.every((id) => ['1', '7'].includes(id)))).toBe(true);
        expect(data).toEqual(before);
    });
    it('reuses manual medals and hides school groups without identity access', () => {
        const boards = resolverBoards(demoData(), settings, false);
        expect(boards.find((board) => board.id === 'manual-mixed')?.medals).toEqual({ gold: 2, silver: 0, bronze: 1 });
        expect(boards.some((board) => board.id.startsWith('school-'))).toBe(false);
    });
    it('requires an explicit freeze point when the contest has none', () => {
        expect(() => prepare({ freezeMode: 'contest' })).toThrow('未设置封榜时间');
        expect(() => prepare({ freezeAtSeconds: 18000 })).toThrow('结束之前');
        expect(prepare({ freezeAtSeconds: 0 }).overview.freezeAtSeconds).toBe(0);
    });
    it('uses a contest freeze without changing its configuration', () => {
        const data = demoData();
        data.contest.frozen_time = 3600;
        expect(prepare({ freezeMode: 'contest' }, data).overview.freezeAtSeconds).toBe(14400);
        expect(data.contest.frozen_time).toBe(3600);
    });
    it('shows a submission exactly at freeze and hides all later verdicts, including CE', () => {
        const data = demoData();
        data.submissions = [
            { submission_id: 'a', team_id: '1', problem_id: 0, timestamp: 1999000, status: 'CORRECT' },
            { submission_id: 'b', team_id: '2', problem_id: 0, timestamp: 2000000, status: 'CORRECT' },
            { submission_id: 'c', team_id: '3', problem_id: 0, timestamp: 2001000, status: 'CORRECT' },
            { submission_id: 'd', team_id: '5', problem_id: 0, timestamp: 2001000, status: 'COMPILATION_ERROR' },
        ];
        const payload = prepare({}, data);
        const frozen = computeCells(payload.snapshot, { frozen: true });
        expect(frozen.results['1'][0].status).toBe('solved');
        expect(frozen.results['2'][0].status).toBe('solved');
        expect(frozen.results['3'][0].status).toBe('pending');
        expect(frozen.results['5'][0].status).toBe('pending');
        expect(payload.game.meta.pendingCount).toBe(2);
        expect(payload.game.steps.filter((step) => step.type === 'resolve').map((step) => step.teamId)).toEqual(expect.arrayContaining(['3', '5']));
    });
    it.each([
        ['WRONG_ANSWER', 1200], ['TIME_LIMIT_EXCEEDED', 1200], ['MEMORY_LIMIT_EXCEEDED', 1200],
        ['RUNTIME_ERROR', 1200], ['OUTPUT_LIMIT_EXCEEDED', 1200], ['JUDGEMENT_FAILED', 1200],
        ['REJECTED', 1200], ['HACKED', 1200], ['COMPILATION_ERROR', 0], ['PRESENTATION_ERROR', 0], ['CANCELED', 0],
    ])('maps %s penalty consistently with Hydro', (status, penalty) => {
        const data = demoData();
        data.submissions = [
            { submission_id: 'a', team_id: '1', problem_id: 0, timestamp: 1000, status },
            { submission_id: 'b', team_id: '1', problem_id: 0, timestamp: 121000, status: 'CORRECT' },
        ];
        const result = computeCells(prepare({}, data).snapshot).standings.find((team) => team.teamId === '1');
        expect(result?.timeSeconds).toBe(121 + penalty);
    });
    it('deduplicates rejudged IDs and excludes out-of-range submissions', () => {
        const data = demoData();
        const record = { submission_id: 'same', team_id: '1', problem_id: 0, timestamp: 120000, status: 'WRONG_ANSWER' };
        data.submissions = [record, { ...record, status: 'CORRECT' }, { ...record, submission_id: 'early', timestamp: -1 },
            { ...record, submission_id: 'late', timestamp: 18000000 }, { ...record, submission_id: 'other-problem', problem_id: 99 }];
        const snapshot = prepare({}, data).snapshot;
        expect(snapshot.submissions).toHaveLength(1);
        expect(computeCells(snapshot).standings[0].timeSeconds).toBe(120);
    });
    it('counts seconds and shares ranks without an ICPC last-solve tiebreak', () => {
        const data = demoData();
        data.submissions = [
            { submission_id: 'a', team_id: '1', problem_id: 0, timestamp: 100000, status: 'CORRECT' },
            { submission_id: 'b', team_id: '1', problem_id: 1, timestamp: 200000, status: 'CORRECT' },
            { submission_id: 'c', team_id: '2', problem_id: 0, timestamp: 140000, status: 'CORRECT' },
            { submission_id: 'd', team_id: '2', problem_id: 1, timestamp: 160000, status: 'CORRECT' },
        ];
        const payload = prepare({ goldCount: 1, silverCount: 0, bronzeCount: 0 }, data);
        expect(computeCells(payload.snapshot).standings.slice(0, 2).map((row) => row.rank)).toEqual([1, 1]);
        expect((payload.game.contest.awards[0] as { teamIds: string[] }).teamIds.sort()).toEqual(['1', '2']);
    });
    it('excludes zero-solve teams from medals and podium', () => {
        const payload = prepare({ goldCount: 100, podiumEnabled: true });
        expect((payload.game.contest.awards as { teamIds: string[] }[]).every((award) => !award.teamIds.includes('8'))).toBe(true);
    });
    it('rejects pending formal results, forces rehearsal while running and records ignored count', () => {
        const data = demoData();
        data.submissions.push({ submission_id: 'waiting', team_id: '1', problem_id: 1, timestamp: 2200000, status: 'PENDING' });
        expect(() => prepare({}, data)).toThrow('未完成评测');
        const payload = prepare({}, data, { ...context, ended: false });
        expect(payload.config.rehearsal).toBe(true);
        expect(payload.overview.unjudgedCount).toBe(1);
        expect(payload.game.meta.discardedUnjudged).toBe(1);
        expect(prepare({ rehearsal: true }, data).config.rehearsal).toBe(true);
    });
    it('never inserts external logo URLs', () => {
        const payload = prepare({}, demoData(), { ...context, logoNames: { '南京晓庄学院': '0123456789ab' } });
        expect(payload.snapshot.teams[0].logo).toBe('/hydro-resolver/logos/0123456789ab.webp');
        expect(payload.game.contest.teams[0].logo).toBe('/hydro-resolver/logos/0123456789ab.webp');
        expect(payload.game.contest.teams.every((team) => team.logo.startsWith('/hydro-resolver/'))).toBe(true);
    });
    it('rejects invalid config and stale/empty board selections', () => {
        expect(() => parseResolverConfig({ autoplay: 'true' }, config)).toThrow();
        expect(() => parseResolverConfig({ freezeAtSeconds: NaN }, config)).toThrow();
        expect(() => prepare({ boardId: 'deleted' })).toThrow('已不存在');
        expect(() => prepare({ mode: 'official' })).toThrow('请选择一个分榜');
    });
});

describe('Resolver persistent session contract', () => {
    const scope = { domainId: 'system', contestId: 'contest-a', ownerId: 1 };
    it('isolates administrators, contests, domains and multiple sessions of one administrator', async () => {
        const { db } = previewDatabase();
        const store = new ResolverSessions(db);
        const a = await store.create(scope, prepare());
        const b = await store.create({ ...scope, ownerId: 2 }, prepare());
        const c = await store.create(scope, prepare());
        expect(new Set([a._id, b._id, c._id]).size).toBe(3);
        expect((await store.list(scope)).map((row) => row.id).sort()).toEqual([a._id, c._id].sort());
        for (const changed of [{ ownerId: 2 }, { domainId: 'other' }, { contestId: 'other' }]) {
            await expect(store.get({ ...scope, ...changed }, a._id)).rejects.toThrow('不存在');
        }
        expect(() => store.checkToken(a, b.controlToken)).toThrow('令牌');
        expect(() => store.checkToken(a, undefined)).toThrow('令牌');
        expect(() => store.checkToken(a, a.controlToken)).not.toThrow();
        expect(JSON.stringify(await store.list(scope))).not.toContain(a.controlToken);
    });
    it('persists an immutable copy and resumes through a fresh store instance', async () => {
        const { db } = previewDatabase();
        const first = new ResolverSessions(db);
        const payload = prepare();
        const session = await first.create(scope, payload);
        payload.snapshot.teams[0].name = 'changed';
        payload.game.steps.length = 0;
        const second = new ResolverSessions(db);
        const result = await second.move(await second.get(scope, session._id), session.actions[1], 0);
        expect(result.status).toBe(200);
        const resumed = await first.get(scope, session._id);
        expect(resumed.index).toBe(session.actions[1]);
        expect(resumed.revision).toBe(1);
        expect((await second.read(resumed)).snapshot.teams[0].name).not.toBe('changed');
        expect((await second.read(resumed)).game.steps.length).toBeGreaterThan(0);
    });
    it('only accepts one concurrent write per revision and returns current progress on conflict', async () => {
        const { db } = previewDatabase();
        const first = new ResolverSessions(db);
        const second = new ResolverSessions(db);
        const session = await first.create(scope, prepare());
        const results = await Promise.all([
            first.move(session, session.actions[1], 0), second.move(session, session.actions[2], 0),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
        expect(results[1].playback).toEqual(results[0].playback);
        await expect(first.move(session, 999999, 1)).rejects.toThrow('步骤');
    });
    it('chunks oversized UTF-8 snapshots, reconstructs them and removes all blocks', async () => {
        const { db, tables } = previewDatabase();
        const store = new ResolverSessions(db);
        const payload = prepare();
        payload.snapshot.name = '中文'.repeat(resolverChunkBytes);
        const session = await store.create(scope, payload);
        expect(session.chunks).toBeGreaterThan(4);
        const blocks = [...tables.get('xcpcio.resolver.chunks')!.values()];
        expect(blocks.every((block) => Buffer.byteLength(block.data) <= 4 * 1024 * 1024)).toBe(true);
        expect((await store.read(session)).snapshot.name).toBe(payload.snapshot.name);
        await store.remove(session);
        expect(tables.get('xcpcio.resolver.chunks')!.size).toBe(0);
        expect(await store.list(scope)).toEqual([]);
    });
    it('cleans up partial creation when a chunk write fails', async () => {
        const { db, tables } = previewDatabase();
        const original = db.collection.bind(db);
        vi.spyOn(db, 'collection').mockImplementation(((name: string) => {
            const collection = original(name as never);
            if (name === 'xcpcio.resolver.chunks') collection.insertOne = vi.fn().mockRejectedValue(new Error('write failed'));
            return collection;
        }) as unknown as typeof db.collection);
        const store = new ResolverSessions(db);
        await expect(store.create(scope, prepare())).rejects.toThrow('write failed');
        expect(tables.get('xcpcio.resolver.sessions')!.size).toBe(0);
        expect(tables.get('xcpcio.resolver.chunks')!.size).toBe(0);
    });
    it('allows the owner to retry an interrupted deletion while playback stays closed', async () => {
        const { db, tables } = previewDatabase();
        const original = db.collection.bind(db);
        let fail = true;
        vi.spyOn(db, 'collection').mockImplementation(((name: string) => {
            const collection = original(name as never);
            if (name === 'xcpcio.resolver.chunks') {
                const remove = collection.deleteMany.bind(collection);
                collection.deleteMany = vi.fn(async (...args: any[]) => {
                    if (fail) throw new Error('delete failed');
                    return remove(...args);
                });
            }
            return collection;
        }) as unknown as typeof db.collection);
        const store = new ResolverSessions(db);
        const session = await store.create(scope, prepare());
        await expect(store.remove(session)).rejects.toThrow('delete failed');
        await expect(store.get(scope, session._id)).rejects.toThrow('删除');
        expect(await store.list(scope)).toHaveLength(1);
        fail = false;
        await store.remove(await store.get(scope, session._id, true));
        expect([...tables.values()].every((table) => table.size === 0)).toBe(true);
    });
});
