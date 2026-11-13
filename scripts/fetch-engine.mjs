#!/usr/bin/env node
/**
 * Fetches the Stockfish engine files Knightfall's Game Review runs in the browser.
 *
 *   node scripts/fetch-engine.mjs           lite single-threaded build  -> apps/web/public/engine/        (~1.9 MB, committed)
 *   node scripts/fetch-engine.mjs --deep    full single-threaded build  -> apps/web/public/engine/deep/   (~99 MB, gitignored)
 *
 * Source: the UNMODIFIED npm package stockfish@19.0.1 (https://github.com/nmrugg/stockfish.js, GPL-3.0).
 * The tarball is downloaded from registry.npmjs.org into data/ (gitignored), its sha512 is checked against
 * BOTH the registry metadata (dist.integrity) and the value pinned below, and only the files listed in
 * WANTED are extracted, byte for byte. Nothing from the package is executed. No npm dependency is added:
 * gzip comes from node:zlib and the tar reader below is ~40 lines.
 *
 * The engine files stay separate, unmodified files next to a copy of the GPL text (aggregation), so
 * Knightfall's own code remains MIT. See THIRD_PARTY_NOTICES.md.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const ENGINE_DIR = process.env.KF_ENGINE_DIR ? path.resolve(process.env.KF_ENGINE_DIR) : path.join(ROOT, 'apps/web/public/engine');

const NAME = 'stockfish';
const VERSION = '19.0.1';
const META_URL = `https://registry.npmjs.org/${NAME}/${VERSION}`;
const TARBALL_URL = `https://registry.npmjs.org/${NAME}/-/${NAME}-${VERSION}.tgz`;
/** dist.integrity of stockfish@19.0.1 as published. A different value means the package changed: stop. */
const PINNED_INTEGRITY = 'sha512-bTwsO4e9HAwPBKls1+szcfibmaWRNzTF20rQE/XPdB3LOSoT6XTZDr1zYwriwSRRFT5MkvqrglPmJrKEVXGnyQ==';
const TARBALL = path.join(DATA_DIR, `${NAME}-${VERSION}.tgz`);
const USER_AGENT = 'Knightfall/0.1';

const deep = process.argv.includes('--deep');

/** tar path -> output path relative to ENGINE_DIR. File names are kept: the loader finds its .wasm by its own name. */
const WANTED = deep
  ? {
      'package/bin/stockfish-19-single.js': 'deep/stockfish-19-single.js',
      'package/bin/stockfish-19-single.wasm': 'deep/stockfish-19-single.wasm',
      'package/Copying.txt': 'deep/COPYING.txt',
    }
  : {
      'package/bin/stockfish-19-lite-single.js': 'stockfish-19-lite-single.js',
      'package/bin/stockfish-19-lite-single.wasm': 'stockfish-19-lite-single.wasm',
      'package/Copying.txt': 'COPYING.txt',
    };

function fail(message) {
  console.error(`\nfetch-engine: ${message}`);
  process.exit(1);
}

async function sha512OfFile(file) {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return `sha512-${hash.digest('base64')}`;
}

async function download() {
  mkdirSync(DATA_DIR, { recursive: true });
  const metaRes = await fetch(META_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!metaRes.ok) fail(`registry metadata request failed: HTTP ${metaRes.status}`);
  const meta = await metaRes.json();
  const integrity = meta?.dist?.integrity;
  if (meta?.dist?.tarball !== TARBALL_URL) fail(`unexpected tarball URL in registry metadata: ${meta?.dist?.tarball}`);
  if (integrity !== PINNED_INTEGRITY) fail(`registry integrity ${integrity} does not match the pinned value. Refusing to continue.`);

  if (existsSync(TARBALL) && (await sha512OfFile(TARBALL)) === PINNED_INTEGRITY) {
    console.log(`Using cached ${path.relative(ROOT, TARBALL)} (sha512 verified)`);
    return;
  }
  console.log(`Downloading ${TARBALL_URL} ...`);
  const res = await fetch(TARBALL_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) fail(`tarball download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(TARBALL));
  const actual = await sha512OfFile(TARBALL);
  if (actual !== PINNED_INTEGRITY) fail(`sha512 mismatch.\n  expected ${PINNED_INTEGRITY}\n  actual   ${actual}`);
  console.log(`Downloaded ${(statSync(TARBALL).size / 1e6).toFixed(1)} MB, sha512 verified`);
}

/**
 * Minimal streaming tar reader: calls `want(name)` for every regular file and, when it returns a path,
 * writes that entry there. Understands ustar name prefixes; skips every other entry type.
 */
async function extract(tarStream, want) {
  let buf = Buffer.alloc(0);
  let remaining = 0; // bytes of the current entry's data still to come
  let padding = 0; // bytes of padding after the data
  let out = null;
  const done = [];
  const text = (b, start, len) => {
    const s = b.subarray(start, start + len);
    const end = s.indexOf(0);
    return s.subarray(0, end < 0 ? len : end).toString('utf8');
  };
  for await (const chunk of tarStream) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (remaining > 0) {
        if (!buf.length) break;
        const take = Math.min(remaining, buf.length);
        if (out) await new Promise((res, rej) => out.write(buf.subarray(0, take), (e) => (e ? rej(e) : res())));
        buf = buf.subarray(take);
        remaining -= take;
        if (remaining === 0 && out) {
          await new Promise((res) => out.end(res));
          out = null;
        }
        continue;
      }
      if (padding > 0) {
        if (buf.length < padding) break;
        buf = buf.subarray(padding);
        padding = 0;
        continue;
      }
      if (buf.length < 512) break;
      const header = buf.subarray(0, 512);
      buf = buf.subarray(512);
      if (header.every((b) => b === 0)) continue; // end-of-archive blocks
      const size = parseInt(text(header, 124, 12).trim() || '0', 8);
      if (!Number.isFinite(size)) fail('corrupt tar header');
      const type = String.fromCharCode(header[156] || 48);
      const prefix = text(header, 345, 155);
      const name = (prefix ? `${prefix}/` : '') + text(header, 0, 100);
      remaining = size;
      padding = (512 - (size % 512)) % 512;
      const target = type === '0' ? want(name) : null;
      if (target) {
        mkdirSync(path.dirname(target), { recursive: true });
        out = createWriteStream(target);
        done.push({ name, target, size });
        if (size === 0) {
          await new Promise((res) => out.end(res));
          out = null;
        }
      }
    }
  }
  return done;
}

function sha256OfFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

await download();
const written = await extract(createReadStream(TARBALL).pipe(zlib.createGunzip()), (name) => (WANTED[name] ? path.join(ENGINE_DIR, WANTED[name]) : null));
const missing = Object.keys(WANTED).filter((n) => !written.some((w) => w.name === n));
if (missing.length) fail(`the tarball did not contain: ${missing.join(', ')}`);
for (const w of written) {
  if (statSync(w.target).size !== w.size) fail(`size mismatch after extracting ${w.name}`);
}

const outDir = deep ? path.join(ENGINE_DIR, 'deep') : ENGINE_DIR;
const rows = written
  .filter((w) => !w.name.endsWith('Copying.txt'))
  .map((w) => `| \`${path.basename(w.target)}\` | ${w.size} | \`${sha256OfFile(w.target)}\` |`)
  .join('\n');
writeFileSync(
  path.join(outDir, 'SOURCE.md'),
  `# Stockfish engine files

These files are **unmodified** copies from the npm package [\`${NAME}@${VERSION}\`](https://www.npmjs.com/package/${NAME}/v/${VERSION})
(Stockfish.js by Nathan Rugg / Chess.com, a WebAssembly build of [Stockfish](https://github.com/official-stockfish/Stockfish)).

- License: **GPL-3.0** (full text in \`COPYING.txt\` next to this file)
- Corresponding source: https://github.com/nmrugg/stockfish.js/tree/v${VERSION}
- Package tarball: ${TARBALL_URL}
- Tarball integrity: \`${PINNED_INTEGRITY}\`
- Fetched by: \`node scripts/fetch-engine.mjs${deep ? ' --deep' : ''}\`

| File | Bytes | sha256 |
| --- | --- | --- |
${rows}

Knightfall loads the engine as a separate Web Worker and talks to it over the text-based UCI protocol.
Knightfall's own source code is MIT licensed and is not derived from these files.
`,
);

console.log(`\nWrote to ${path.relative(ROOT, outDir) || outDir}:`);
for (const w of written) console.log(`  ${path.basename(w.target).padEnd(34)} ${String(w.size).padStart(10)} bytes`);
console.log('  SOURCE.md');
