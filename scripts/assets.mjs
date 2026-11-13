import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopeBoardCss } from '../lib/style-scope.mjs';
import { patchBoardEngine } from '../lib/patch-engine.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(path.dirname(require.resolve('@xcpcio/board-app/package.json')), 'dist');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('无效的插件版本号');
const publicRoot = path.join(root, 'public/hydro-xcpcio');
const target = path.join(publicRoot, version);
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
const js = html.match(/assets\/(index-[\w-]+\.js)/)?.[1];
const css = html.match(/assets\/(index-[\w-]+\.css)/)?.[1];
if (!js || !css) throw new Error('无法识别 XCPCIO 0.85.4 入口文件');
await rm(publicRoot, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(dist, target, { recursive: true });
let extendedEngines = 0;
for (const file of await readdir(path.join(target, 'assets'))) {
    if (/^rank-.*\.js$/.test(file)) {
        const enginePath = path.join(target, 'assets', file);
        await writeFile(enginePath, patchBoardEngine(await readFile(enginePath, 'utf8')));
        extendedEngines++;
    }
    if (!file.endsWith('.css')) continue;
    const cssPath = path.join(target, 'assets', file);
    await writeFile(cssPath, scopeBoardCss(await readFile(cssPath, 'utf8'), cssPath));
}
if (extendedEngines !== 1) throw new Error('无法定位唯一的 XCPCIO 榜单引擎');
await cp(path.join(root, 'client'), target, { recursive: true });
await cp(path.join(root, 'lib/award-policy.mjs'), path.join(target, 'award-policy.mjs'));
await cp(path.join(root, 'licenses/XCPCIO-MIT.txt'), path.join(target, 'XCPCIO-LICENSE.txt'));
// School logos are fetched ahead of time by scripts/fetch-logos.mjs; the board works without them.
await cp(path.join(root, 'logos'), path.join(target, 'logos'), { recursive: true }).catch((error) => { if (error.code !== 'ENOENT') throw error; });
await writeFile(path.join(publicRoot, 'manifest.json'), JSON.stringify({ base: version, js: `assets/${js}`, css: `assets/${css}` }));
console.log(`XCPCIO assets ready: ${js}`);
const resolverTarget = path.join(root, 'public/hydro-resolver');
await rm(resolverTarget, { recursive: true, force: true });
await cp(path.join(root, 'resolver/public'), resolverTarget, { recursive: true });
await cp(path.join(root, 'logos'), path.join(resolverTarget, 'logos'), { recursive: true });
await cp(path.join(root, 'licenses'), path.join(resolverTarget, 'licenses'), { recursive: true });
console.log('Resolver assets ready: v1.4.0 with Hydro adapters');
