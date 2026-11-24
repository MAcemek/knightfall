import { BUCKET_SIZE, GAME_PUZZLE_PREFIX, MAX_BUCKET, MIN_BUCKET, seededFloat, type Puzzle } from '@knightfall/core';
import type { Attempt, CustomPuzzle, WoodCycle, WoodSet } from '../../shared/db.ts';
import { daysBetween, dayKeyOf } from '../../shared/localDate.ts';

/** Rules of Woodpecker sets: one fixed list of puzzles solved completely, then again in shorter cycles. */

export const SET_SIZES = [100, 200, 400, 1000] as const;
export const DEFAULT_SIZE = 200;
export const DEFAULT_FIRST_DAYS = 28;
export const MIN_FIRST_DAYS = 1;
export const MAX_FIRST_DAYS = 90;
/** One puzzle never counts for more than this: a walk away from the board must not wreck the times. */
export const CAP_MS = 5 * 60_000;
export const MAX_NAME = 60;
/** The pool is the puzzles from this many rating points below the player's puzzle rating up to it. */
export const POOL_BELOW = 200;

export function clampFirstDays(v: unknown): number {
  if (v === null || (typeof v === 'string' && v.trim() === '')) return DEFAULT_FIRST_DAYS;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_FIRST_DAYS;
  return Math.min(MAX_FIRST_DAYS, Math.max(MIN_FIRST_DAYS, Math.round(n)));
}

export function cleanName(raw: unknown, fallback = 'Woodpecker set'): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
  return s || fallback;
}

export function capMs(ms: number): number {
  return Number.isFinite(ms) ? Math.min(CAP_MS, Math.max(0, Math.round(ms))) : 0;
}

/** Target days of cycle n (1-based): the first target halves every cycle, rounded up, never below 1. 28, 14, 7, 4, 2, 1, 1. */
export function targetDays(first: number, n: number): number {
  const f = clampFirstDays(first);
  const k = Math.max(0, Math.floor(Number.isFinite(n) ? n : 1) - 1);
  return Math.max(1, Math.ceil(f / 2 ** k));
}

/* ---------- building a set ---------- */

export interface BuildInput {
  /** Ids of picked puzzles, in the order they were picked. */
  picks: readonly string[];
  /** Every puzzle of the player's own (customPuzzles rows). */
  own: readonly CustomPuzzle[];
  /** Candidates from the player's rating range. */
  pool: readonly Puzzle[];
  /** Extra candidates, used only when `pool` is not enough. */
  widened?: readonly Puzzle[];
  size: number;
  seed: string;
}

/** A plain Puzzle: the stored extras (dates, author, counters) stay out of a frozen set. */
export function plainPuzzle(p: Puzzle): Puzzle {
  const out: Puzzle = { id: p.id, fen: p.fen, moves: [...p.moves], opponentFirst: p.opponentFirst, rating: p.rating, themes: [...p.themes], source: p.source };
  if (p.title !== undefined) out.title = p.title;
  if (p.gameUrl !== undefined) out.gameUrl = p.gameUrl;
  if (p.alts) out.alts = Object.fromEntries(Object.entries(p.alts).map(([k, v]) => [k, [...v]]));
  return out;
}

const usable = (p: Puzzle) => Array.isArray(p.moves) && p.moves.length > 0 && typeof p.id === 'string' && p.id.length > 0;

/** The player's own puzzles in set order: the picks first, then the other puzzles made from their games, newest first. */
export function ownInOrder(picks: readonly string[], own: readonly CustomPuzzle[]): CustomPuzzle[] {
  const byId = new Map(own.map((p) => [p.id, p]));
  const out: CustomPuzzle[] = [];
  const seen = new Set<string>();
  for (const id of picks) {
    const p = byId.get(id);
    if (p && usable(p) && !seen.has(id)) {
      seen.add(id);
      out.push(p);
    }
  }
  const rest = own
    .filter((p) => p.id.startsWith(GAME_PUZZLE_PREFIX) && usable(p) && !seen.has(p.id))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (a.id < b.id ? -1 : 1));
  return [...out, ...rest];
}

export function ownCounts(picks: readonly string[], own: readonly CustomPuzzle[], size: number): { picked: number; games: number } {
  const list = ownInOrder(picks, own).slice(0, Math.max(0, size));
  const pickSet = new Set(picks);
  const picked = list.filter((p) => pickSet.has(p.id)).length;
  return { picked, games: list.length - picked };
}

function seededOrder(list: readonly Puzzle[], seed: string): Puzzle[] {
  return list
    .map((p, i) => ({ p, k: seededFloat(seed, i) }))
    .sort((a, b) => a.k - b.k || (a.p.id < b.p.id ? -1 : 1))
    .map((x) => x.p);
}

/** The puzzles of a new set, easy to hard. Unique ids, never longer than `size`. */
export function buildSet({ picks, own, pool, widened = [], size, seed }: BuildInput): Puzzle[] {
  const want = Math.max(0, Math.floor(size));
  const out: Puzzle[] = [];
  const seen = new Set<string>();
  const add = (p: Puzzle) => {
    if (out.length >= want || seen.has(p.id) || !usable(p)) return;
    seen.add(p.id);
    out.push(plainPuzzle(p));
  };
  for (const p of ownInOrder(picks, own)) add(p);
  // Own puzzles have to be known before the pool is shuffled, so a pool puzzle that is also an own one is not drawn twice.
  const fresh = (list: readonly Puzzle[]) => list.filter((p) => !seen.has(p.id) && usable(p));
  for (const p of seededOrder(fresh(pool), `${seed}:pool`)) add(p);
  if (out.length < want) for (const p of seededOrder(fresh(widened), `${seed}:wide`)) add(p);
  return out.sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1));
}

export interface PoolPlan {
  /** Rating range the main pool is filtered to. */
  low: number;
  high: number;
  /** Buckets that hold the range. */
  main: number[];
  /** More buckets to take whole when the main pool is too small: downwards first, then upwards. */
  widen: number[];
}

const bucketOf = (r: number) => Math.max(MIN_BUCKET, Math.min(MAX_BUCKET, Math.floor(r / BUCKET_SIZE) * BUCKET_SIZE));

export function poolBuckets(rating: number): PoolPlan {
  const r = Number.isFinite(rating) ? Math.round(rating) : 1200;
  const low = r - POOL_BELOW;
  const first = bucketOf(low);
  const last = bucketOf(r);
  const main: number[] = [];
  for (let b = first; b <= last; b += BUCKET_SIZE) main.push(b);
  const widen: number[] = [];
  for (let b = first - BUCKET_SIZE; b >= MIN_BUCKET; b -= BUCKET_SIZE) widen.push(b);
  for (let b = last + BUCKET_SIZE; b <= MAX_BUCKET; b += BUCKET_SIZE) widen.push(b);
  return { low, high: r, main, widen };
}

export const inRange = (p: Puzzle, plan: PoolPlan) => p.rating >= plan.low && p.rating <= plan.high;

/* ---------- progress of one cycle ---------- */

type WoodAttempt = Pick<Attempt, 'puzzleId' | 'solved' | 'hintsUsed' | 'timeMs' | 'at'> & Partial<Pick<Attempt, 'id' | 'mode' | 'setId' | 'cycle'>>;

/** The first attempt of every puzzle in this cycle. Later rows for the same puzzle are ignored. */
export function firstAttempts<T extends WoodAttempt>(set: Pick<WoodSet, 'id' | 'items'>, cycle: number, attempts: readonly T[]): Map<string, T> {
  const inSet = new Set(set.items.map((p) => p.id));
  const out = new Map<string, T>();
  for (const a of attempts) {
    if (a.mode !== undefined && a.mode !== 'woodpecker') continue;
    if (a.setId !== set.id || a.cycle !== cycle || !inSet.has(a.puzzleId)) continue;
    const cur = out.get(a.puzzleId);
    if (!cur || a.at < cur.at || (a.at === cur.at && (a.id ?? 0) < (cur.id ?? 0))) out.set(a.puzzleId, a);
  }
  return out;
}

export const isPass = (a: Pick<Attempt, 'solved' | 'hintsUsed'>) => a.solved && a.hintsUsed === 0;

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export interface CycleProgress {
  total: number;
  done: number;
  passed: number;
  /** Index in set order of the first puzzle with no attempt yet, or -1 when all are played. */
  firstUnplayed: number;
  /** Puzzles whose first attempt was not a pass, in set order. */
  misses: string[];
  totalMs: number;
  medianMs: number | null;
  /** Passed over played, 0 to 1. Null before the first attempt. */
  accuracy: number | null;
  finished: boolean;
}

export function cycleProgress(set: Pick<WoodSet, 'id' | 'items'>, cycle: number, attempts: readonly WoodAttempt[]): CycleProgress {
  const firsts = firstAttempts(set, cycle, attempts);
  const misses: string[] = [];
  const times: number[] = [];
  let passed = 0;
  let firstUnplayed = -1;
  set.items.forEach((p, i) => {
    const a = firsts.get(p.id);
    if (!a) {
      if (firstUnplayed < 0) firstUnplayed = i;
      return;
    }
    times.push(capMs(a.timeMs));
    if (isPass(a)) passed++;
    else misses.push(p.id);
  });
  const done = firsts.size;
  return {
    total: set.items.length,
    done,
    passed,
    firstUnplayed,
    misses,
    totalMs: times.reduce((s, t) => s + t, 0),
    medianMs: median(times),
    accuracy: done ? passed / done : null,
    finished: set.items.length > 0 && done >= set.items.length,
  };
}

/* ---------- pace ---------- */

export type PaceState = 'ahead' | 'on-pace' | 'behind' | 'overdue' | 'done';

export interface Pace {
  /** The day of the cycle, the start day being 1. */
  dayIndex: number;
  targetDays: number;
  /** How many should be done by the end of today. */
  expectedDone: number;
  done: number;
  doneToday: number;
  /** Still needed today to be on pace. */
  todayQuota: number;
  /** What today asks in all: doneToday + todayQuota, or less when more was done on earlier days than needed. */
  todayGoal: number;
  state: PaceState;
}

function expectedBy(total: number, dayIndex: number, days: number): number {
  return Math.min(total, Math.max(0, Math.ceil((total * dayIndex) / Math.max(1, days))));
}

/**
 * Where the cycle stands against its target, in local days. 'ahead' = more than today asks for is done,
 * 'on-pace' = nothing from earlier days is missing, 'behind' = earlier days are not caught up,
 * 'overdue' = past the last target day and not finished.
 */
export function pace(set: Pick<WoodSet, 'id' | 'items' | 'cycles'>, cycle: number, attempts: readonly WoodAttempt[], nowMs: number): Pace {
  const c = set.cycles.find((x) => x.n === cycle);
  const days = Math.max(1, c?.targetDays ?? 1);
  const startKey = dayKeyOf(c?.startedAt ?? nowMs);
  const today = dayKeyOf(nowMs);
  const dayIndex = Math.max(1, daysBetween(startKey, today) + 1);
  const total = set.items.length;
  const firsts = firstAttempts(set, cycle, attempts);
  const done = firsts.size;
  let doneToday = 0;
  for (const a of firsts.values()) if (dayKeyOf(a.at) === today) doneToday++;
  const expectedDone = expectedBy(total, dayIndex, days);
  const todayQuota = Math.max(0, expectedDone - done);
  const todayGoal = Math.max(0, expectedDone - (done - doneToday));
  const expectedBefore = expectedBy(total, dayIndex - 1, days);
  let state: PaceState;
  if (total > 0 && done >= total) state = 'done';
  else if (dayIndex > days) state = 'overdue';
  else if (done > expectedDone) state = 'ahead';
  else if (done >= expectedBefore) state = 'on-pace';
  else state = 'behind';
  return { dayIndex, targetDays: days, expectedDone, done, doneToday, todayQuota, todayGoal, state };
}

/* ---------- cycles of a set ---------- */

export function currentCycle(set: Pick<WoodSet, 'cycles'>): WoodCycle | undefined {
  return set.cycles[set.cycles.length - 1];
}

export function canStartNext(set: Pick<WoodSet, 'cycles'>): boolean {
  const c = currentCycle(set);
  return !!c && c.finishedAt !== null;
}

/** The set with its next cycle started. A set whose current cycle is not finished comes back unchanged. */
export function startNextCycle(set: WoodSet, now: number, firstTarget = set.cycles[0]?.targetDays ?? DEFAULT_FIRST_DAYS): WoodSet {
  if (!canStartNext(set)) return set;
  const n = set.cycles.length + 1;
  return { ...set, cycles: [...set.cycles, { n, startedAt: now, finishedAt: null, targetDays: targetDays(firstTarget, n) }] };
}

export function firstCycle(now: number, firstTarget: number): WoodCycle {
  return { n: 1, startedAt: now, finishedAt: null, targetDays: targetDays(firstTarget, 1) };
}

/** Whether a set can be used (a damaged row from an old backup is skipped instead of crashing a page). */
export function isUsableSet(s: unknown): s is WoodSet {
  const x = s as Partial<WoodSet> | null;
  return !!x && typeof x.id === 'string' && Array.isArray(x.items) && Array.isArray(x.cycles) && x.cycles.length > 0 && x.cycles.every((c) => !!c && typeof c.n === 'number' && typeof c.startedAt === 'number');
}

/** The newest set with an unfinished cycle. */
export function pickActive<T extends Pick<WoodSet, 'createdAt' | 'cycles'>>(sets: readonly T[]): T | null {
  let best: T | null = null;
  for (const s of sets) {
    const c = s.cycles?.[s.cycles.length - 1];
    if (!c || c.finishedAt !== null) continue;
    if (!best || s.createdAt > best.createdAt) best = s;
  }
  return best;
}

export interface CycleSummary {
  n: number;
  targetDays: number;
  /** Days from start to finish, counting the start day as 1. Null while unfinished. */
  days: number | null;
  accuracy: number | null;
  medianMs: number | null;
  totalMs: number;
  done: number;
  total: number;
  finished: boolean;
}

export function cycleSummaries(set: Pick<WoodSet, 'id' | 'items' | 'cycles'>, attempts: readonly WoodAttempt[]): CycleSummary[] {
  return set.cycles.map((c) => {
    const p = cycleProgress(set, c.n, attempts);
    const finished = c.finishedAt !== null;
    return {
      n: c.n,
      targetDays: c.targetDays,
      days: c.finishedAt !== null ? Math.max(1, daysBetween(dayKeyOf(c.startedAt), dayKeyOf(c.finishedAt)) + 1) : null,
      accuracy: p.accuracy,
      medianMs: p.medianMs,
      totalMs: p.totalMs,
      done: p.done,
      total: p.total,
      finished,
    };
  });
}

export interface CycleComparison {
  /** Percentage points, positive = better. Null when either cycle has no attempts. */
  accuracyPoints: number | null;
  /** Milliseconds, negative = faster. */
  medianMs: number | null;
}

export function compareCycles(prev: Pick<CycleSummary, 'accuracy' | 'medianMs'>, cur: Pick<CycleSummary, 'accuracy' | 'medianMs'>): CycleComparison {
  return {
    accuracyPoints: prev.accuracy === null || cur.accuracy === null ? null : Math.round((cur.accuracy - prev.accuracy) * 100),
    medianMs: prev.medianMs === null || cur.medianMs === null ? null : cur.medianMs - prev.medianMs,
  };
}

/** What a stored attempt changes: nothing when the puzzle is not in the set, the cycle is closed or the puzzle was played already. */
export function planRecord(
  set: Pick<WoodSet, 'id' | 'items' | 'cycles'>,
  cycle: number,
  existing: readonly WoodAttempt[],
  puzzleId: string,
): { write: boolean; finishes: boolean } {
  const c = set.cycles.find((x) => x.n === cycle);
  if (!c || c.finishedAt !== null || !set.items.some((p) => p.id === puzzleId)) return { write: false, finishes: false };
  const firsts = firstAttempts(set, cycle, existing);
  if (firsts.has(puzzleId)) return { write: false, finishes: false };
  return { write: true, finishes: firsts.size + 1 >= set.items.length };
}

/** The cycle exists, is still open and holds the puzzle. False means a result for it cannot be stored at all. */
export function canRecord(set: Pick<WoodSet, 'items' | 'cycles'>, cycle: number, puzzleId: string): boolean {
  const c = set.cycles.find((x) => x.n === cycle);
  return !!c && c.finishedAt === null && set.items.some((p) => p.id === puzzleId);
}

/* ---------- text ---------- */

export function formatMs(ms: number | null): string {
  if (ms === null) return '-';
  const tenths = Math.round(ms / 100);
  if (tenths < 100) return `${(tenths / 10).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export function formatTotal(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs} s`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

export const formatPercent = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const daysText = (n: number) => plural(n, 'day', 'days');

export function paceLine(p: Pace): string {
  switch (p.state) {
    case 'done':
      return 'Cycle done.';
    case 'overdue':
      return `Past the target of ${daysText(p.targetDays)}. ${plural(Math.max(0, p.todayQuota), 'puzzle', 'puzzles')} to catch up.`;
    case 'behind':
      return `Behind: ${plural(p.todayQuota, 'puzzle', 'puzzles')} to catch up today.`;
    case 'ahead':
      return 'Ahead of pace.';
    default:
      return p.todayQuota > 0 ? `${plural(p.todayQuota, 'puzzle', 'puzzles')} still to do today.` : 'On pace. Today is done.';
  }
}
