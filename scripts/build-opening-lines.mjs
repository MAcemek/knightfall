#!/usr/bin/env node
/**
 * Builds apps/web/public/opening-lines.json from the Lichess opening names (CC0):
 * https://github.com/lichess-org/chess-openings  (files a.tsv ... e.tsv, columns: eco, name, pgn)
 *
 *   node scripts/build-opening-lines.mjs
 *
 * Output: { "families": [{ "name", "eco", "lines": [{ "id", "name", "eco", "uci": ["e2e4", ...] }] }] }
 * A family is the opening name before ":" ("Italian Game: Evans Gambit" -> "Italian Game"); its eco is the one
 * of its first line. Lines shorter than 4 plies or that chess.js cannot replay are dropped. Line ids are stable:
 * the ECO code plus a short hash of the moves.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(process.env.KF_OPENINGS_DIR ? path.resolve(process.env.KF_OPENINGS_DIR) : path.join(ROOT, 'apps/web/public'), 'opening-lines.json');
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const FILES = ['a', 'b', 'c', 'd', 'e'];
const USER_AGENT = 'Knightfall/0.1';
const MIN_PLIES = 4;

/** FNV-1a, base 36, 5 characters. */
function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(-5);
}

const families = new Map(); // name -> { name, eco, lines }
const usedIds = new Set();
let rows = 0;
let skipped = 0;
let short = 0;

for (const f of FILES) {
  const res = await fetch(`${BASE}/${f}.tsv`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    console.error(`build-opening-lines: ${f}.tsv failed with HTTP ${res.status}`);
    process.exit(1);
  }
  const lines = (await res.text()).split(/\r?\n/);
  if (lines[0].trim() !== 'eco\tname\tpgn') {
    console.error(`build-opening-lines: unexpected header in ${f}.tsv: ${lines[0]}`);
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
    const uci = chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
    if (uci.length < MIN_PLIES) {
      short++;
      continue;
    }
    const base = `${eco}-${shortHash(uci.join(' '))}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}${n}`;
    usedIds.add(id);
    const family = name.split(':')[0].trim();
    let fam = families.get(family);
    if (!fam) {
      fam = { name: family, eco, lines: [] };
      families.set(family, fam);
    }
    fam.lines.push({ id, name, eco, uci });
  }
}

const out = { families: [...families.values()].sort((a, b) => a.name.localeCompare(b.name)) };
const lineCount = out.families.reduce((n, fam) => n + fam.lines.length, 0);
if (lineCount < 2000) {
  console.error(`build-opening-lines: only ${lineCount} lines, expected more than 2000. Not writing.`);
  process.exit(1);
}
mkdirSync(path.dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify(out);
writeFileSync(OUT_FILE, json);
console.log(`opening-lines.json: ${out.families.length} families, ${lineCount} lines from ${rows} rows (${skipped} unreadable, ${short} under ${MIN_PLIES} plies), ${(json.length / 1024).toFixed(0)} KB`);
