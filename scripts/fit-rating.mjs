// Calibrate Game Review's "estimated game rating" against real games.
//
// 1. Collects rated, Lichess-analysed blitz/rapid games (public API, one request at a time, generic
//    User-Agent) from players sampled across the rating range (finished arenas, many of them rating-capped).
// 2. Fits rating from accuracy (own, and own + opponent) by least squares to show how weak that signal is
//    (2026-11: R^2 about 0.1, median error about 350 points), so Game Review shows no rating estimate.
// 3. Prints the TYPICAL_ACCURACY table (accuracy percentiles per 200-point rating band) that Game Review
//    does show; copy it into packages/core/src/analysis/winning.ts.
//
// Accuracy (not ACPL) is used because Knightfall's accuracy follows the same formula as Lichess's and lands
// within about a point of it, while ACPL depends heavily on the engine and depth.
//
//   node scripts/fit-rating.mjs [--users 60] [--games 30] [--out data/rating-samples.json]
//   node scripts/fit-rating.mjs --fit-only [--out data/rating-samples.json]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const USERS = Number(arg('users', 60));
const GAMES = Number(arg('games', 30));
const OUT = arg('out', 'data/rating-samples.json');
const FIT_ONLY = process.argv.includes('--fit-only');
const UA = { 'User-Agent': 'knightfall-rating-fit', Accept: 'application/x-ndjson' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, accept = UA.Accept) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { ...UA, Accept: accept } });
    if (res.status === 429) {
      console.log('429, waiting 65 s');
      await sleep(65_000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.text();
  }
  throw new Error(`rate limited: ${url}`);
}
const ndjson = (text) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function collect() {
  const arenas = JSON.parse(await get('https://lichess.org/api/tournament', 'application/json')).finished ?? [];
  const byBand = new Map(); // 200-point band -> usernames
  for (const t of arenas.slice(0, 40)) {
    await sleep(1100);
    let rows;
    try {
      rows = ndjson(await get(`https://lichess.org/api/tournament/${t.id}/results?nb=60`));
    } catch (e) {
      console.log(String(e));
      continue;
    }
    for (const r of rows) {
      if (!r.username || !r.rating) continue;
      const band = Math.floor(r.rating / 200) * 200;
      const set = byBand.get(band) ?? new Set();
      set.add(r.username);
      byBand.set(band, set);
    }
  }
  const bands = [...byBand.keys()].sort((a, b) => a - b);
  console.log('bands', bands.map((b) => `${b}:${byBand.get(b).size}`).join(' '));
  const perBand = Math.max(2, Math.ceil(USERS / Math.max(1, bands.length)));
  const users = bands.flatMap((b) => [...byBand.get(b)].slice(0, perBand));
  console.log(`sampling ${users.length} users`);

  const samples = [];
  const seen = new Set();
  for (const u of users) {
    await sleep(1100);
    let games;
    try {
      games = ndjson(
        await get(`https://lichess.org/api/games/user/${encodeURIComponent(u)}?max=${GAMES}&rated=true&analysed=true&accuracy=true&perfType=blitz,rapid&moves=false&tags=false`),
      );
    } catch (e) {
      console.log(String(e));
      continue;
    }
    for (const g of games) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      for (const side of ['white', 'black']) {
        const p = g.players?.[side];
        const o = g.players?.[side === 'white' ? 'black' : 'white'];
        if (!p?.rating || p.provisional || typeof p.analysis?.accuracy !== 'number' || typeof o?.analysis?.accuracy !== 'number') continue;
        samples.push({ game: g.id, rating: p.rating, accuracy: p.analysis.accuracy, oppAccuracy: o.analysis.accuracy, acpl: p.analysis.acpl, speed: g.speed });
      }
    }
    process.stdout.write(`\r${samples.length} samples`);
  }
  console.log();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(samples));
  return samples;
}

/** Least squares with an intercept. rows: [features..., y]. */
function leastSquares(rows) {
  const k = rows[0].length; // intercept + (k - 1) features
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const v = new Array(k).fill(0);
  for (const r of rows) {
    const x = [1, ...r.slice(0, -1)];
    const y = r[r.length - 1];
    for (let i = 0; i < k; i++) {
      v[i] += x[i] * y;
      for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j];
    }
  }
  for (let i = 0; i < k; i++) {
    for (let r = i + 1; r < k; r++) {
      const f = A[r][i] / A[i][i];
      for (let j = i; j < k; j++) A[r][j] -= f * A[i][j];
      v[r] -= f * v[i];
    }
  }
  const beta = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = v[i];
    for (let j = i + 1; j < k; j++) s -= A[i][j] * beta[j];
    beta[i] = s / A[i][i];
  }
  const ys = rows.map((r) => r[r.length - 1]);
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  const res = rows.map((r) => r[r.length - 1] - [1, ...r.slice(0, -1)].reduce((s, x, i) => s + x * beta[i], 0));
  const sse = res.reduce((s, e) => s + e * e, 0);
  const sst = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const abs = res.map(Math.abs).sort((p, q) => p - q);
  return {
    beta: beta.map((b) => +b.toFixed(2)),
    r2: +(1 - sse / sst).toFixed(3),
    medianError: Math.round(abs[Math.floor(abs.length / 2)]),
    p80Error: Math.round(abs[Math.floor(abs.length * 0.8)]),
    n: rows.length,
  };
}

const samples = FIT_ONLY ? JSON.parse(await readFile(OUT, 'utf8')) : await collect();

// Older sample files have no oppAccuracy: pair the two sides of each game instead.
const byGame = new Map();
for (const s of samples) byGame.set(`${s.game}:${s.rating}:${s.accuracy}`, s);
const rows = samples
  .map((s) => {
    if (typeof s.oppAccuracy === 'number') return s;
    const other = samples.find((o) => o.game === s.game && o !== s);
    return other ? { ...s, oppAccuracy: other.accuracy } : null;
  })
  .filter(Boolean);

const x = (acc) => Math.log(101 - acc);
console.log(`${rows.length} player-games, ${new Set(rows.map((r) => r.game)).size} games`);
console.log('own accuracy only          ', leastSquares(rows.map((r) => [x(r.accuracy), r.rating])));
console.log('own + opponent accuracy    ', leastSquares(rows.map((r) => [x(r.accuracy), x(r.oppAccuracy), r.rating])));
console.log('linear own + opp (compare) ', leastSquares(rows.map((r) => [r.accuracy, r.oppAccuracy, r.rating])));

// What the data does support: the spread of accuracy at a known rating. Printed as the TYPICAL_ACCURACY
// table for packages/core/src/analysis/winning.ts (200-point bands with enough games).
const MIN_ROWS = 80;
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const bandsOut = [];
for (let lo = 400; lo < 3000; lo += 200) {
  const acc = rows.filter((r) => r.rating >= lo && r.rating < lo + 200).map((r) => r.accuracy).sort((p, q) => p - q);
  if (acc.length < MIN_ROWS) continue;
  bandsOut.push({ min: lo, max: lo + 200, p25: Math.round(pct(acc, 0.25)), p50: Math.round(pct(acc, 0.5)), p75: Math.round(pct(acc, 0.75)), n: acc.length });
}
console.log('TYPICAL_ACCURACY =', JSON.stringify(bandsOut));
