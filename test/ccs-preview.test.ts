import http from 'node:http';
import { describe, it, expect } from 'vitest';
import { createCcsPreview, previewCcsId } from '../preview/ccs';
import { demoData } from './fixture';
import { defaultSettings } from '../lib/settings';

describe('CCS real HTTP with isolated Hydro adapter', () => {
    it('loads all endpoint data through the Hydro source adapter and streams NDJSON', async () => {
        const preview = createCcsPreview(demoData(), () => ({ ...defaultSettings, ccsApi: true, publicAccess: true, showIdentity: true }));
        const server = http.createServer(async (req, res) => {
            try { if (!await preview.handle(req, res, new URL(req.url!, 'http://localhost'))) res.writeHead(404).end(); }
            catch (error) { res.writeHead(500).end(String(error)); }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${(server.address() as any).port}/d/system/ccsapi`;
        const auth = { authorization: `Basic ${Buffer.from('admin:preview').toString('base64')}` };
        try {
            expect((await (await fetch(`${base}/`)).json()).version).toBe('2026-01');
            const contests = await (await fetch(`${base}/contests`)).json(); expect(contests[0].id).toBe(previewCcsId);
            const url = `${base}/contests/${previewCcsId}`;
            for (const endpoint of ['access', 'account', 'judgement-types', 'languages', 'problems', 'groups', 'organizations', 'teams', 'persons', 'accounts', 'state', 'submissions', 'judgements', 'runs', 'clarifications', 'awards', 'commentary', 'scoreboard']) {
                const response = await fetch(`${url}/${endpoint}`, { headers: auth });
                expect(response.status, `${endpoint}: ${await response.clone().text()}`).toBe(200);
                expect(response.headers.get('access-control-allow-origin')).toBe('*');
            }
            const problems = await (await fetch(`${url}/problems`, { headers: auth })).json();
            expect(problems[0]).toMatchObject({ time_limit: 1, memory_limit: 256, code_limit: 128 });
            await preview.app.writer.tick();
            const abort = new AbortController();
            const feed = await fetch(`${url}/event-feed`, { headers: auth, signal: abort.signal });
            expect(feed.headers.get('content-type')).toBe('application/x-ndjson');
            const reader = feed.body!.getReader();
            const first = await reader.read();
            const lines = new TextDecoder().decode(first.value).trim().split('\n').map(line => JSON.parse(line));
            expect(lines[0].token).toMatch(/^[a-f0-9]+-\d+$/);
            await reader.cancel(); abort.abort();
            const submissions = await (await fetch(`${url}/submissions`, { headers: auth })).json();
            const file = await fetch(`${base}/${submissions[0].files[0].href}`, { headers: auth });
            expect(file.headers.get('content-type')).toBe('application/zip'); expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(50);
        } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await preview.close(); }
    });
});
