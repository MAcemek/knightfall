import {
  bucketFileName, bucketFor, dailyIndex, MAX_BUCKET, MIN_BUCKET, BUCKET_SIZE, nearRating, pickIndex, rampRating,
  GAME_PUZZLE_PREFIX, rowToPuzzle, type Puzzle, type PuzzleRow,
} from '@knightfall/core';
import type { PuzzleWorkerReply, PuzzleWorkerRequest } from './puzzleWorker.ts';
import { bucketSearchOrder, matchesThemes } from './themes.ts';

/**
 * Loads puzzles from /puzzles/*.json (built by scripts/build-puzzles.mjs from the Lichess CC0 database).
 * Buckets are 100 rating points wide and fetched lazily + cached.
 * Download + JSON parsing + row conversion run in a Web Worker (shared/puzzleWorker.ts) when the browser
 * has one; otherwise, or if the worker fails, the same work happens on the main thread.
 */

const cache = new Map<string, Promise<Puzzle[]>>();

function fetchOnMainThread(file: string): Promise<Puzzle[]> {
  return fetch(`/puzzles/${file}`)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${file}: ${r.status}`);
      return r.json() as Promise<PuzzleRow[]>;
    })
    .then((rows) => rows.map(rowToPuzzle));
}

/** undefined = not started yet, null = unavailable (no Worker support, or it crashed). */
let worker: Worker | null | undefined;
let nextRequest = 0;
const waiting = new Map<number, { resolve: (p: Puzzle[]) => void; reject: (e: Error) => void }>();

function puzzleWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./puzzleWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<PuzzleWorkerReply>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.puzzles);
      else w.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      // The worker itself is broken: stop using it. Callers retry on the main thread.
      worker?.terminate();
      worker = null;
      for (const w of waiting.values()) w.reject(new Error('Puzzle worker failed'));
      waiting.clear();
    };
  }
  return worker;
}

function fetchPuzzleFile(file: string): Promise<Puzzle[]> {
  const w = puzzleWorker();
  if (!w) return fetchOnMainThread(file);
  return new Promise<Puzzle[]>((resolve, reject) => {
    const id = ++nextRequest;
    waiting.set(id, { resolve, reject });
    const request: PuzzleWorkerRequest = { id, file };
    w.postMessage(request);
  }).catch(() => fetchOnMainThread(file));
}

async function loadFile(file: string): Promise<Puzzle[]> {
  let p = cache.get(file);
  if (!p) {
    p = fetchPuzzleFile(file)
      .catch((e) => {
        cache.delete(file);
        throw e;
      });
    cache.set(file, p);
  }
  return p;
}

export function loadBucket(bucket: number): Promise<Puzzle[]> {
  return loadFile(bucketFileName(bucket));
}

/** Nearest non-empty bucket to `rating` (high buckets can be sparse). */
async function nonEmptyBucket(rating: number): Promise<Puzzle[]> {
  const start = bucketFor(rating);
  for (let d = 0; d <= (MAX_BUCKET - MIN_BUCKET) / BUCKET_SIZE; d++) {
    for (const b of d === 0 ? [start] : [start - d * BUCKET_SIZE, start + d * BUCKET_SIZE]) {
      if (b < MIN_BUCKET || b > MAX_BUCKET) continue;
      const list = await loadBucket(b);
      if (list.length) return list;
    }
  }
  throw new Error('No puzzles available. Run `npm run puzzles` to build the puzzle set.');
}

/** Prefetch the buckets around a rating so the next puzzle loads instantly. */
export function prefetchAround(rating: number) {
  const b = bucketFor(rating);
  for (const x of [b - BUCKET_SIZE, b, b + BUCKET_SIZE]) if (x >= MIN_BUCKET && x <= MAX_BUCKET) void loadBucket(x).catch(() => {});
}

/**
 * A random puzzle near the player's rating (rated mode). `exclude` avoids repeats.
 * `seed`/`index` make it reproducible if needed; defaults to random.
 */
export async function puzzleNear(rating: number, exclude: Set<string> = new Set(), seed: string | number = Math.random() * 1e9, index = 0): Promise<Puzzle> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const target = nearRating(rating, seed, index * 31 + attempt);
    const list = await nonEmptyBucket(target);
    const p = list[pickIndex(seed, index * 31 + attempt, list.length)];
    if (!exclude.has(p.id)) return p;
  }
  const list = await nonEmptyBucket(rating);
  return list.find((p) => !exclude.has(p.id)) ?? list[0];
}

/**
 * The i-th puzzle of a ramping sequence (Rush & Battle). Pure function of (seed, index),
 * so two Battle players with the same seed get exactly the same puzzles.
 */
export async function sequencePuzzle(seed: number | string, index: number, opts: { start?: number; step?: number } = {}): Promise<Puzzle> {
  const target = rampRating(index, opts.start, opts.step);
  const list = await nonEmptyBucket(target);
  return list[pickIndex(seed, index, list.length)];
}

export function prefetchSequence(seed: number | string, fromIndex: number, count = 3, opts: { start?: number; step?: number } = {}) {
  for (let i = fromIndex; i < fromIndex + count; i++) void sequencePuzzle(seed, i, opts).catch(() => {});
}

/**
 * Look a puzzle up by id. `rating` is the puzzle's rating as stored on the Attempt/ReviewItem, so only
 * its bucket (and the two neighbours, in case the set was rebuilt) is fetched. Null if it is gone.
 * Puzzles made from the player's own games ("game-..." ids, see shared/analysis/practice.ts) live in
 * IndexedDB instead of the bundled set.
 */
export async function findPuzzle(id: string, rating: number): Promise<Puzzle | null> {
  if (id.startsWith(GAME_PUZZLE_PREFIX)) {
    // Imported lazily so this module stays loadable without IndexedDB.
    const { db } = await import('./db.ts');
    return (await db.customPuzzles.get(id)) ?? null;
  }
  const b = bucketFor(rating);
  for (const bucket of [b, b - BUCKET_SIZE, b + BUCKET_SIZE]) {
    if (bucket < MIN_BUCKET || bucket > MAX_BUCKET) continue;
    try {
      const hit = (await loadBucket(bucket)).find((p) => p.id === id);
      if (hit) return hit;
    } catch {
      /* try the next bucket */
    }
  }
  return null;
}

/**
 * Theme training: a random puzzle that has ANY of `themes`, as close to `rating` as the puzzle set allows.
 * Buckets are searched outward from the target (nearest first) and the first bucket with a match wins,
 * so rare themes still return something. `exclude` avoids repeats; when every match is excluded the
 * repeats are allowed again. Null only if no puzzle in the whole set has the theme.
 *
 * Deliberately separate from sequencePuzzle()/puzzleNear(): Battle and Rush sequences must stay untouched.
 */
export async function themedPuzzleNear(
  rating: number,
  themes: readonly string[],
  exclude: ReadonlySet<string> = new Set(),
  rand: () => number = Math.random,
): Promise<Puzzle | null> {
  const target = Math.round(rating + (rand() * 2 - 1) * 120);
  const order = bucketSearchOrder(bucketFor(target), MIN_BUCKET, MAX_BUCKET, BUCKET_SIZE);
  let fallback: Puzzle[] | null = null;
  for (const bucket of order) {
    let list: Puzzle[];
    try {
      list = await loadBucket(bucket);
    } catch {
      continue;
    }
    const matches = list.filter((p) => matchesThemes(p.themes, themes));
    if (!matches.length) continue;
    const fresh = matches.filter((p) => !exclude.has(p.id));
    if (fresh.length) return fresh[Math.floor(rand() * fresh.length)];
    fallback ??= matches;
  }
  return fallback ? fallback[Math.floor(rand() * fallback.length)] : null;
}

export function loadDailyPool(): Promise<Puzzle[]> {
  return loadFile('daily-pool.json');
}

/** The daily puzzle for a UTC date key (YYYY-MM-DD). Same for everyone. */
export async function dailyPuzzle(dateKey: string): Promise<Puzzle> {
  const pool = await loadDailyPool();
  if (!pool.length) throw new Error('Daily pool is empty. Run `npm run puzzles`.');
  const p = pool[dailyIndex(dateKey, pool.length)];
  return { ...p, title: `Daily Puzzle · ${dateKey}` };
}
