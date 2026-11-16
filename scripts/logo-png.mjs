// Maintainer tool: small PNG copies of the school logos for the CCS Contest API, whose image
// files may only be PNG, JPEG or SVG (the registry ships WebP). Needs `dwebp` (libwebp) on PATH.
// Writes logos/png/<id>.png (palette PNG, at most 160 px) and logos/png/index.json with sizes.
// Run with `node scripts/logo-png.mjs` after `pnpm logos`.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logos = path.join(root, 'logos');
const target = path.join(logos, 'png');
const SIZE = 160;

/** PAM (P7) as written by `dwebp -pam`: RGBA pixels. */
function readPam(buffer) {
    const end = buffer.indexOf('ENDHDR\n');
    const header = buffer.subarray(0, end).toString('ascii');
    const value = (key) => Number(new RegExp(`${key} (\\d+)`).exec(header)?.[1]);
    const width = value('WIDTH');
    const height = value('HEIGHT');
    if (value('DEPTH') !== 4) throw new Error('需要 RGBA 图像');
    return { width, height, pixels: buffer.subarray(end + 7, end + 7 + width * height * 4) };
}

/**
 * Median-cut palette of at most 256 RGBA colours. Fully transparent pixels share one entry.
 */
function quantize(pixels) {
    const colors = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        const key = a === 0 ? 0 : ((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | a) >>> 0;
        colors.set(key, (colors.get(key) || 0) + 1);
    }
    const unpack = (key) => [key >>> 24, (key >>> 16) & 255, (key >>> 8) & 255, key & 255];
    let boxes = [[...colors.keys()].map((key) => ({ c: key === 0 ? [0, 0, 0, 0] : unpack(key), n: colors.get(key) }))];
    while (boxes.length < 256) {
        let best = -1;
        let bestRange = 0;
        let bestChannel = 0;
        boxes.forEach((box, index) => {
            if (box.length < 2) return;
            for (let channel = 0; channel < 4; channel++) {
                let min = 255;
                let max = 0;
                for (const { c } of box) { min = Math.min(min, c[channel]); max = Math.max(max, c[channel]); }
                const range = (max - min) * Math.sqrt(box.reduce((sum, item) => sum + item.n, 0));
                if (range > bestRange) { bestRange = range; best = index; bestChannel = channel; }
            }
        });
        if (best < 0) break;
        const box = boxes[best].sort((a, b) => a.c[bestChannel] - b.c[bestChannel]);
        const half = box.reduce((sum, item) => sum + item.n, 0) / 2;
        let count = 0;
        let cut = 1;
        for (; cut < box.length - 1; cut++) { count += box[cut - 1].n; if (count >= half) break; }
        boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
    }
    const palette = boxes.map((box) => {
        const total = box.reduce((sum, item) => sum + item.n, 0);
        return [0, 1, 2, 3].map((channel) => Math.round(box.reduce((sum, item) => sum + item.c[channel] * item.n, 0) / total));
    });
    const lookup = new Map();
    boxes.forEach((box, index) => { for (const { c } of box) lookup.set(((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) >>> 0, index); });
    const indices = new Uint8Array(pixels.length / 4);
    for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        const key = a === 0 ? 0 : ((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | a) >>> 0;
        indices[i / 4] = lookup.get(key);
    }
    return { palette, indices };
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (data) => { let c = 0xffffffff; for (const byte of data) c = CRC[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

function writePng(width, height, { palette, indices }) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bit depth
    header[9] = 3; // indexed colour
    const raw = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width + 1)] = 0;
        Buffer.from(indices.buffer, y * width, width).copy(raw, y * (width + 1) + 1);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('PLTE', Buffer.from(palette.flatMap(([r, g, b]) => [r, g, b]))),
        chunk('tRNS', Buffer.from(palette.map(([, , , a]) => a))),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const registry = JSON.parse(await readFile(path.join(logos, 'index.json'), 'utf8'));
const ids = [...Object.keys(registry.images), 'icpc'];
await mkdir(target, { recursive: true });
const temp = await mkdtemp(path.join(os.tmpdir(), 'logo-png-'));
const index = {};
try {
    for (const id of ids) {
        const pam = path.join(temp, `${id}.pam`);
        // Scale the longer side to SIZE, keeping the aspect ratio (0 keeps it in dwebp).
        await run('dwebp', ['-quiet', '-pam', path.join(logos, `${id}.webp`), '-o', pam]);
        const full = readPam(await readFile(pam));
        const scale = full.width >= full.height ? ['-scale', String(Math.min(SIZE, full.width)), '0'] : ['-scale', '0', String(Math.min(SIZE, full.height))];
        await run('dwebp', ['-quiet', '-pam', ...scale, path.join(logos, `${id}.webp`), '-o', pam]);
        const { width, height, pixels } = readPam(await readFile(pam));
        const png = writePng(width, height, quantize(pixels));
        await writeFile(path.join(target, `${id}.png`), png);
        index[id] = { width, height, md5: createHash('md5').update(png).digest('hex') };
    }
} finally {
    await rm(temp, { recursive: true, force: true });
}
await writeFile(path.join(target, 'index.json'), `${JSON.stringify(index)}\n`);
console.log(`PNG 校徽已生成：${ids.length} 个`);
