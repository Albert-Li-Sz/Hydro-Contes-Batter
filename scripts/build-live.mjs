// Rebuild live/dist from ICPC Live v3 at the pinned commit with live/frontend.patch applied.
// Needs git, pnpm and network access; the result is committed, so installs never run this.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = JSON.parse(await readFile(path.join(root, 'live/UPSTREAM.json'), 'utf8'));
const patch = path.join(root, 'live/frontend.patch');
const patchSha = createHash('sha256').update(await readFile(patch)).digest('hex');
const work = await mkdtemp(path.join(os.tmpdir(), 'hydro-live-'));
const run = (command, args, cwd, env = {}) => execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
try {
    const source = path.join(work, 'live-v3');
    run('git', ['clone', '--depth', '1', '--branch', upstream.tag, upstream.repository, source], work);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source }).toString().trim();
    if (commit !== upstream.commit) throw new Error(`${upstream.tag} is ${commit}, expected ${upstream.commit}`);
    run('git', ['apply', patch], source);
    const frontend = path.join(source, 'src/frontend');
    run('pnpm', ['install', '--frozen-lockfile'], frontend);
    const dist = path.join(work, 'dist');
    // Bundles are served from the plugin's public folder; hashed names keep upgrades out of stale caches.
    run('pnpm', ['run', 'build'], path.join(frontend, 'admin-overlay'), { PUBLIC_URL: '/hydro-live/admin/', BUILD_PATH: path.join(dist, 'admin') });
    run('pnpm', ['exec', 'vite', 'build'], path.join(frontend, 'overlay'), { PUBLIC_URL: '/hydro-live/overlay/', BUILD_PATH: path.join(dist, 'overlay') });
    await rm(path.join(root, 'live/dist'), { recursive: true, force: true });
    await cp(dist, path.join(root, 'live/dist'), { recursive: true });
    await writeFile(path.join(root, 'live/UPSTREAM.json'), `${JSON.stringify({ ...upstream, patchSha256: patchSha, builtAt: new Date().toISOString() }, null, 2)}\n`);
    console.log(`ICPC Live ${upstream.tag} frontend rebuilt with patch ${patchSha.slice(0, 12)}`);
} finally {
    await rm(work, { recursive: true, force: true });
}
