#!/usr/bin/env node
/**
 * Builds Knightfall's puzzle set from the Lichess puzzle database (CC0).
 *
 *   node scripts/build-puzzles.mjs [--per-bucket 1200] [--daily 3000]
 *
 * Downloads https://database.lichess.org/lichess_db_puzzle.csv.zst into data/ (gitignored, ~250 MB),
 * streams it through zstd, and writes rating-bucketed JSON files to apps/web/public/puzzles/.
 *
 * Output rows are compact: [id, fen, "uci uci ...", rating, "theme theme ..."]
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'apps/web/public/puzzles');
const SRC_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const SRC_FILE = path.join(DATA_DIR, 'lichess_db_puzzle.csv.zst');

const args = process.argv.slice(2);
const argNum = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const PER_BUCKET = argNum('--per-bucket', 1200);
const DAILY_SIZE = argNum('--daily', 3000);
const BUCKET_SIZE = 100;
const MIN_BUCKET = 400;
const MAX_BUCKET = 2900;

// Deterministic PRNG so the build is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261108);

async function download() {
  if (existsSync(SRC_FILE) && statSync(SRC_FILE).size > 10_000_000) {
    console.log(`Using cached ${path.relative(ROOT, SRC_FILE)}`);
    return;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  console.log(`Downloading ${SRC_URL} ...`);
  const res = await fetch(SRC_URL, { headers: { 'User-Agent': 'knightfall-puzzle-builder' } });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let got = 0;
  let lastPct = -1;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      console.log(`  ${pct}% (${(got / 1e6).toFixed(0)} MB)`);
    }
  });
  await pipeline(body, createWriteStream(SRC_FILE));
  console.log('Download complete.');
}

/**
 * The Lichess file is "pzstd" style: many zstd frames, each preceded by a skippable frame
 * (magic 0x184D2A5?) whose payload is the next frame's compressed size. Node's decoder stops
 * after one frame, so decode frame by frame and yield the decompressed chunks in order.
 */
async function* zstdFrames(file) {
  const size = statSync(file).size;
  const fd = openSync(file, 'r');
  const head = Buffer.alloc(8);
  let offset = 0;
  try {
    while (offset + 8 <= size) {
      readSync(fd, head, 0, 8, offset);
      const magic = head.readUInt32LE(0);
      if ((magic & 0xfffffff0) === 0x184d2a50) {
        offset += 8 + head.readUInt32LE(4);
        continue;
      }
      // A real frame. Its length is the size announced by the preceding skippable frame;
      // if we don't know it (plain single-frame file), decode to end of file.
      const frameLen = pendingFrameLen(fd, offset, size);
      const stream = createReadStream(file, { start: offset, end: offset + frameLen - 1 }).pipe(zlib.createZstdDecompress());
      for await (const chunk of stream) yield chunk;
      offset += frameLen;
    }
  } finally {
    closeSync(fd);
  }
}

function pendingFrameLen(fd, offset, size) {
  // Look back 12 bytes for a pzstd header announcing this frame's compressed size.
  if (offset >= 12) {
    const b = Buffer.alloc(12);
    readSync(fd, b, 0, 12, offset - 12);
    if ((b.readUInt32LE(0) & 0xfffffff0) === 0x184d2a50 && b.readUInt32LE(4) === 4) {
      return b.readUInt32LE(8);
    }
  }
  return size - offset;
}

async function* lines(chunks) {
  let rest = '';
  const decoder = new TextDecoder();
  for await (const chunk of chunks) {
    rest += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = rest.indexOf('\n')) >= 0) {
      yield rest.slice(0, i).replace(/\r$/, '');
      rest = rest.slice(i + 1);
    }
  }
  rest += decoder.decode();
  if (rest) yield rest;
}

function parseCsvLine(line) {
  // Lichess puzzle CSV has no quoted commas in the fields we use.
  return line.split(',');
}

async function build() {
  if (typeof zlib.createZstdDecompress !== 'function') {
    throw new Error('This Node version lacks zlib.createZstdDecompress (need Node >= 22.15 / 23.8).');
  }
  const buckets = new Map(); // bucket -> { seen, rows }
  const dailyCandidates = { seen: 0, rows: [] };
  const dailyCap = DAILY_SIZE;

  let header = true;
  let n = 0;
  let kept = 0;
  for await (const line of lines(zstdFrames(SRC_FILE))) {
    if (header) {
      header = false;
      continue;
    }
    n++;
    if (n % 500_000 === 0) console.log(`  scanned ${n.toLocaleString()} puzzles`);
    const [id, fen, moves, ratingS, rdS, popS, playsS, themes] = parseCsvLine(line);
    const rating = Number(ratingS);
    const rd = Number(rdS);
    const pop = Number(popS);
    const plays = Number(playsS);
    if (!id || !fen || !moves) continue;
    if (pop < 80 || plays < 1000 || rd > 90) continue;
    const bucket = Math.max(MIN_BUCKET, Math.min(MAX_BUCKET, Math.floor(rating / BUCKET_SIZE) * BUCKET_SIZE));
    const row = [id, fen, moves, rating, themes ?? ''];
    kept++;

    // Reservoir sampling per bucket keeps a uniform sample without holding 5M rows in memory.
    let b = buckets.get(bucket);
    if (!b) buckets.set(bucket, (b = { seen: 0, rows: [] }));
    b.seen++;
    if (b.rows.length < PER_BUCKET) b.rows.push(row);
    else {
      const j = Math.floor(rand() * b.seen);
      if (j < PER_BUCKET) b.rows[j] = row;
    }

    // Daily pool: well-liked, mid-rated, multi-move puzzles.
    if (rating >= 1400 && rating <= 2000 && pop >= 90 && plays >= 5000 && !(themes ?? '').includes('oneMove')) {
      dailyCandidates.seen++;
      if (dailyCandidates.rows.length < dailyCap) dailyCandidates.rows.push(row);
      else {
        const j = Math.floor(rand() * dailyCandidates.seen);
        if (j < dailyCap) dailyCandidates.rows[j] = row;
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const index = [];
  for (let bucket = MIN_BUCKET; bucket <= MAX_BUCKET; bucket += BUCKET_SIZE) {
    const b = buckets.get(bucket) ?? { rows: [] };
    b.rows.sort((x, y) => x[0].localeCompare(y[0])); // stable order => same pick on every client
    const file = `bucket-${String(bucket).padStart(4, '0')}.json`;
    writeFileSync(path.join(OUT_DIR, file), JSON.stringify(b.rows));
    index.push({ bucket, file, count: b.rows.length });
  }
  dailyCandidates.rows.sort((x, y) => x[0].localeCompare(y[0]));
  writeFileSync(path.join(OUT_DIR, 'daily-pool.json'), JSON.stringify(dailyCandidates.rows));
  writeFileSync(
    path.join(OUT_DIR, 'index.json'),
    JSON.stringify({ source: 'Lichess puzzle database (CC0)', builtFrom: n, kept, buckets: index, daily: dailyCandidates.rows.length }, null, 2),
  );
  console.log(`Scanned ${n.toLocaleString()}, eligible ${kept.toLocaleString()}.`);
  console.log(`Wrote ${index.reduce((s, b) => s + b.count, 0).toLocaleString()} bucketed puzzles + ${dailyCandidates.rows.length} daily puzzles to ${path.relative(ROOT, OUT_DIR)}`);
}

await download();
await build();
