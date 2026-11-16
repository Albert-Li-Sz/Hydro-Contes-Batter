/** Optional integration check against an isolated MongoDB. Never uses the Hydro production DB. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ccsStore } from '../lib/ccs/store';
import { ccsFixture } from '../test/ccs-fixture';

const require = createRequire(requireResolveHydro());
function requireResolveHydro() { return createRequire(import.meta.url).resolve('hydrooj/package.json'); }
const { MongoClient } = require('mongodb');
const uri = process.env.CCS_TEST_MONGO_URI;
if (!uri) throw new Error('Set CCS_TEST_MONGO_URI to an isolated MongoDB');
const database = process.env.CCS_TEST_DB || `ccs_test_${randomUUID().replaceAll('-', '')}`;
if (!/^ccs_test_[a-f0-9]+$/.test(database)) throw new Error('Refusing a non-test database name');

async function main() {
    const client = await MongoClient.connect(uri);
    const db = client.db(database);
    const store = ccsStore({ db } as any);
    const key = 'system/68ea00000000000000000000';
    const childMode = process.argv[2];
    if (childMode) {
        try {
            if (childMode === 'lease') console.log(JSON.stringify(await store.acquireLease('test', 'child', 15000)));
            if (childMode === 'append') {
                for (let i = 0; i < 10; i++) {
                    let written = false;
                    while (!written) {
                        try { await store.append(key, 'full', [{ type: 'teams', id: process.argv[3], data: { id: process.argv[3], name: String(i) } }]); written = true; }
                        catch (error) { if (!(error as Error).message.includes('writer claim')) throw error; }
                    }
                }
                console.log('done');
            }
        } finally { await client.close(); }
        return;
    }
    const child = (mode: string, id = '') => new Promise<string>((resolve, reject) => {
        const processHandle = spawn(process.execPath, ['--import', 'tsx', import.meta.filename, mode, id], {
            env: { ...process.env, CCS_TEST_DB: database }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = ''; let stderr = '';
        processHandle.stdout.on('data', data => { stdout += data; });
        processHandle.stderr.on('data', data => { stderr += data; });
        processHandle.on('error', reject);
        processHandle.on('exit', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `exit ${code}`)));
    });
    try {
        await store.ensureIndexes();
        assert(await store.acquireLease('test', 'parent', 15000));
        assert.equal(await child('lease'), 'false');
        await store.releaseLease('test', 'parent');
        assert.equal(await child('lease'), 'true');
        await Promise.all([child('append', 'a'), child('append', 'b')]);
        const events = await store.eventsAfter(key, 'full', 0);
        assert(events.length >= 20); // Overlap recovery may notify the same object again; never lose a write.
        assert.deepEqual(events.map(event => event.seq), Array.from({ length: events.length }, (_, i) => i + 1));
        for (const id of ['a', 'b']) for (let i = 0; i < 10; i++) assert(events.some(event => event.id === id && (event.data as any).name === String(i)));
        const first = events.length + 1;
        await db.collection('xcpcio.ccs.contests').updateOne({ _id: key }, { $set: {
            'seq.full': first, 'pending.full': { first, notifications: [{ type: 'state', id: null, data: { end_of_updates: new Date().toISOString() } }], at: new Date() },
        } });
        const restarted = ccsStore({ db } as any);
        await restarted.append(key, 'full', [{ type: 'teams', id: 'late', data: { id: 'late' } }]);
        assert.equal(await restarted.lastSeq(key, 'full'), first);
        assert.equal((await restarted.eventsAfter(key, 'full', first - 1)).at(-1)?.type, 'state');
        const source = ccsFixture();
        await store.freezeSource(key, source);
        assert.equal((await restarted.frozenSource(key))?.records.length, source.records.length);
        const claims = await Promise.allSettled([store.mapId(key, 'submissions', 'one', 'a'), store.mapId(key, 'submissions', 'one', 'b')]);
        assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1);
        console.log('MongoDB: independent process lease exclusion/takeover, concurrent event sequences, pending-batch recovery, terminal feed, snapshot and unique submission IDs passed.');
    } finally {
        await db.dropDatabase();
        await client.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
