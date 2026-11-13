// Maintainer tool: download the Hydro school logo registry once at its original resolution in
// `logos/`, so the board never loads images from a third-party host at runtime.
// Needs `cwebp` (libwebp) on PATH. Run with `pnpm logos`; originals are cached in `.logo-cache/`.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const run = promisify(execFile);
const origin = 'https://avatar.hydrooj.com';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.logo-cache');
const target = path.join(root, 'logos');
const headers = { 'User-Agent': 'hydro-scoreboard-logo-fetch' };

/** Same normalisation as the board uses for school names (client/member-filter.mjs). */
const normalize = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const entities = { quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'", apos: "'" };
// The page embeds its data as Astro island props: every value is a `[type, value]` pair.
function decode([type, value]) {
    if (type === 1) return value.map(decode);
    if (type === 0 && value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
    return value;
}

const response = await fetch(`${origin}/`, { headers });
if (!response.ok) throw new Error(`学校 Logo 注册表请求失败 HTTP ${response.status}`);
const page = await response.text();
const props = /<astro-island[^>]*component-url="[^"]*LogoRegistry[^"]*"[^>]*props="([^"]*)"/.exec(page)?.[1];
if (!props) throw new Error('无法在注册表页面中找到学校 Logo 数据，页面结构可能已变化');
const registry = decode([0, JSON.parse(props.replace(/&(quot|amp|lt|gt|#39|apos);/g, (_, name) => entities[name]))]).logos;
if (!Array.isArray(registry) || !registry.length) throw new Error('学校 Logo 注册表为空');

await mkdir(cache, { recursive: true });
const workspace = await mkdtemp(path.join(root, '.logos-build-'));
const staging = path.join(workspace, 'logos');
await mkdir(staging);
const names = {};
const images = {};
const failed = [];
let done = 0;
let preserveWorkspace = false;
async function handle(entry) {
    if (typeof entry?.name !== 'string' || typeof entry.src !== 'string' || !/^\/org\/[^/?#]+\.webp(\?build=[\w-]+)?$/.test(entry.src)) {
        failed.push(`${entry?.name}: 意外的地址`); return;
    }
    const id = createHash('sha256').update(entry.name).digest('hex').slice(0, 12);
    const build = /build=([\w-]+)/.exec(entry.src)?.[1] || 'x';
    const original = path.join(cache, `${id}-${build}.webp`);
    let body = await readFile(original).catch(() => null);
    if (!body) {
        const response = await fetch(origin + entry.src, { headers });
        if (!response.ok) { failed.push(`${entry.name}: HTTP ${response.status}`); return; }
        body = Buffer.from(await response.arrayBuffer());
        // Only accept an image of sane size. Some registry files are PNG or JPEG behind a .webp name.
        const magic = body.subarray(0, 12).toString('latin1');
        const image = (magic.startsWith('RIFF') && magic.endsWith('WEBP')) || magic.startsWith('\x89PNG\r\n\x1a\n') || magic.startsWith('\xff\xd8\xff');
        if (body.length > 5_000_000 || !image) { failed.push(`${entry.name}: 不是有效的图片`); return; }
        await writeFile(original, body);
    }
    try {
        const output = path.join(staging, `${id}.webp`);
        // Keep existing WebP bytes, including transparency. PNG/JPEG sources retain
        // their pixel dimensions and are converted without another lossy encoding.
        if (body.subarray(0, 4).toString() === 'RIFF') await writeFile(output, body);
        else await run('cwebp', ['-quiet', '-lossless', '-exact', '-metadata', 'icc', '-m', '6', original, '-o', output]);
        images[id] = {
            source: origin + entry.src,
            sourceSha256: createHash('sha256').update(body).digest('hex'),
            sha256: createHash('sha256').update(await readFile(output)).digest('hex'),
        };
    } catch (error) { failed.push(`${entry.name}: ${error.message.split('\n')[0]}`); return; }
    for (const alias of [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]) {
        const key = normalize(alias);
        // Registry-internal codes ("6217", "G12") are not school names.
        if (key && !/^[a-z]?\d+$/.test(key)) names[key] ??= id;
    }
    if (++done % 100 === 0) console.log(`${done} / ${registry.length}`);
}
try {
    const queue = [...registry];
    const workers = await Promise.allSettled(Array.from({ length: 6 }, async () => { while (queue.length) await handle(queue.shift()); }));
    for (const worker of workers) if (worker.status === 'rejected') failed.push(worker.reason.message);
    if (failed.length) throw new Error(`失败 ${failed.length} 个，保留现有资源：\n${failed.join('\n')}`);

    // The fallback mark also keeps its original dimensions and transparency.
    const dist = path.join(path.dirname(createRequire(import.meta.url).resolve('@xcpcio/board-app/package.json')), 'dist', 'assets');
    const icpc = (await readdir(dist)).find((file) => /^icpc-[\w-]+\.png$/.test(file));
    if (!icpc) throw new Error('无法找到 XCPCIO 自带的 ICPC 标志');
    await run('cwebp', ['-quiet', '-lossless', '-exact', '-metadata', 'icc', '-m', '6', path.join(dist, icpc), '-o', path.join(staging, 'icpc.webp')]);

    const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const sortedImages = Object.fromEntries(Object.entries(images).sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(path.join(staging, 'index.json'), JSON.stringify({
        source: origin, resolution: 'original', encoding: 'original-webp-or-lossless', names: sorted, images: sortedImages,
    }));
    // Publish only after all downloads and conversions succeed. Roll back the
    // directory swap if publishing fails, so a retry retains a usable registry.
    const previous = path.join(workspace, 'previous');
    let hadPrevious = true;
    try { await rename(target, previous); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        hadPrevious = false;
    }
    try { await rename(staging, target); } catch (error) {
        if (hadPrevious) {
            try { await rename(previous, target); } catch (rollbackError) {
                preserveWorkspace = true;
                throw new AggregateError([error, rollbackError], `资源发布失败，原资源保留在 ${previous}`);
            }
        }
        throw error;
    }
    console.log(`学校 Logo：${Object.keys(images).length} 个原始分辨率校徽，${Object.keys(sorted).length} 个名称`);
} finally {
    if (!preserveWorkspace) await rm(workspace, { recursive: true, force: true });
}
