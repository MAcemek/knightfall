#!/usr/bin/env node
/**
 * Builds apps/web/public/openings.json from the Lichess opening names (CC0):
 * https://github.com/lichess-org/chess-openings  (files a.tsv ... e.tsv, columns: eco, name, pgn)
 *
 *   node scripts/build-openings.mjs
 *
 * Output: one JSON object { "<EPD>": ["<ECO>", "<name>"], ... } where EPD is the first four FEN fields of
 * the position after the opening's moves, computed with the same chess.js the app uses (so the en-passant
 * field always matches what the app computes at runtime). When two openings reach the same position the
 * one with the longer move sequence wins (it is the more specific name).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(process.env.KF_OPENINGS_DIR ? path.resolve(process.env.KF_OPENINGS_DIR) : path.join(ROOT, 'apps/web/public'), 'openings.json');
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const FILES = ['a', 'b', 'c', 'd', 'e'];
const USER_AGENT = 'Knightfall/0.1';

const table = new Map(); // epd -> { eco, name, plies }
let rows = 0;
let skipped = 0;

for (const f of FILES) {
  const res = await fetch(`${BASE}/${f}.tsv`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    console.error(`build-openings: ${f}.tsv failed with HTTP ${res.status}`);
    process.exit(1);
  }
  const lines = (await res.text()).split(/\r?\n/);
  if (lines[0].trim() !== 'eco\tname\tpgn') {
    console.error(`build-openings: unexpected header in ${f}.tsv: ${lines[0]}`);
    process.exit(1);
  }
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    rows++;
    const chess = new Chess();
    try {
      chess.loadPgn(pgn);
    } catch {
      skipped++;
      continue;
    }
    const plies = chess.history().length;
    const epd = chess.fen().split(' ').slice(0, 4).join(' ');
    const prev = table.get(epd);
    if (!prev || plies > prev.plies) table.set(epd, { eco, name, plies });
  }
}

if (table.size < 3000) {
  console.error(`build-openings: only ${table.size} positions, expected more than 3000. Not writing.`);
  process.exit(1);
}
const out = {};
for (const epd of [...table.keys()].sort()) {
  const { eco, name } = table.get(epd);
  out[epd] = [eco, name];
}
mkdirSync(path.dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(out));
console.log(`openings.json: ${table.size} positions from ${rows} rows (${skipped} unreadable), ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
