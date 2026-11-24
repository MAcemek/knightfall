import { useLiveQuery } from 'dexie-react-hooks';
import type { Puzzle } from '@knightfall/core';
import { db, defaults, getKV, KEYS, type Attempt, type WoodSet } from '../../shared/db.ts';
import type { RunnerResult } from '../../shared/PuzzlePlayer/index.ts';
import { loadBucket } from '../../shared/puzzleSource.ts';
import { readNextPicks, removeNextPicks } from '../../shared/woodNext.ts';
import {
  buildSet, capMs, cleanName, clampFirstDays, canRecord, cycleSummaries, firstCycle, inRange, isUsableSet, ownInOrder, pickActive, planRecord, poolBuckets,
  startNextCycle, type CycleSummary,
} from './woodLogic.ts';

/** Saving and loading Woodpecker sets. The rules are in woodLogic.ts. */

export const LOAD_ERROR = 'The puzzles could not be loaded. Check your connection and try again.';

/** Only sets that can be shown, newest first. */
async function readSets(): Promise<WoodSet[]> {
  return (await db.woodSets.orderBy('createdAt').reverse().toArray()).filter(isUsableSet);
}

export async function getSet(id: string): Promise<WoodSet | null> {
  const s = await db.woodSets.get(id);
  return isUsableSet(s) ? s : null;
}

/** All attempts of one set, every cycle. */
export async function readSetAttempts(setId: string): Promise<Attempt[]> {
  return db.attempts.where('mode').equals('woodpecker').filter((a) => a.setId === setId).toArray();
}

/** The newest set whose cycles are not all finished. */
export async function activeSet(): Promise<WoodSet | null> {
  return pickActive(await readSets());
}

/** Per-cycle summary of a set, for the Coach page and the set page. */
export async function setCycleSummaries(set: WoodSet): Promise<CycleSummary[]> {
  return cycleSummaries(set, await readSetAttempts(set.id));
}

/** Live list of sets, newest first. Undefined while loading. */
export function useWoodSets(): WoodSet[] | undefined {
  return useLiveQuery(readSets, []);
}

/** Live set. Undefined while loading, null when there is none with this id. */
export function useWoodSet(id: string | undefined): WoodSet | null | undefined {
  return useLiveQuery(async () => (id ? await getSet(id) : null), [id]);
}

/** Live attempts of a set. Undefined while loading. */
export function useSetAttempts(id: string | undefined): Attempt[] | undefined {
  return useLiveQuery(async () => (id ? await readSetAttempts(id) : []), [id]);
}

/** Live attempts of every set, grouped by set id. Undefined while loading. */
export function useAllWoodAttempts(): Map<string, Attempt[]> | undefined {
  return useLiveQuery(async () => {
    const map = new Map<string, Attempt[]>();
    for (const a of await db.attempts.where('mode').equals('woodpecker').toArray()) {
      if (!a.setId) continue;
      const list = map.get(a.setId);
      if (list) list.push(a);
      else map.set(a.setId, [a]);
    }
    return map;
  }, []);
}

/** Own puzzles that would go into a new set, live. */
export function useOwnPuzzles() {
  return useLiveQuery(() => db.customPuzzles.toArray(), []);
}

function puzzleRatingNow(raw: unknown): number {
  const r = (raw as { rating?: unknown } | null)?.rating;
  return typeof r === 'number' && Number.isFinite(r) ? r : defaults.puzzleRating.rating;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

export interface NewSetInput {
  name: string;
  size: number;
  firstTargetDays: number;
}

/** Builds and saves a new set with cycle 1 started. Throws an Error with a plain message when the puzzles are not available. */
export async function createSet(input: NewSetInput): Promise<WoodSet> {
  const size = Math.max(1, Math.floor(input.size));
  const [picks, own, rating] = await Promise.all([readNextPicks(), db.customPuzzles.toArray(), getKV<unknown>(KEYS.puzzleRating, defaults.puzzleRating)]);
  const plan = poolBuckets(puzzleRatingNow(rating));
  const ownCount = Math.min(size, ownInOrder(picks, own).length);

  let pool: Puzzle[];
  try {
    pool = (await Promise.all(plan.main.map((b) => loadBucket(b)))).flat().filter((p) => inRange(p, plan));
  } catch {
    throw new Error(LOAD_ERROR);
  }
  const ownIds = new Set(ownInOrder(picks, own).map((p) => p.id));
  const needed = size - ownCount;
  const widened: Puzzle[] = [];
  if (pool.filter((p) => !ownIds.has(p.id)).length < needed) {
    let have = pool.length;
    for (const b of plan.widen) {
      if (have >= needed) break;
      try {
        const list = await loadBucket(b);
        widened.push(...list);
        have += list.length;
      } catch {
        throw new Error(LOAD_ERROR);
      }
    }
  }

  const seed = `${Date.now()}:${Math.random()}`;
  const items = buildSet({ picks, own, pool, widened, size, seed });
  if (!items.length) throw new Error('There are no puzzles for this set. Try again later.');

  const now = Date.now();
  const set: WoodSet = { id: newId(), createdAt: now, name: cleanName(input.name), items, cycles: [firstCycle(now, clampFirstDays(input.firstTargetDays))] };
  await db.transaction('rw', db.woodSets, db.kv, async () => {
    await db.woodSets.add(set);
    await removeNextPicks(items.map((p) => p.id));
  });
  return set;
}

/**
 * Stores the first outcome of a puzzle in the cycle. A second attempt on the same puzzle in the same cycle is not written.
 * The attempt and the end of the cycle are written in one transaction. Resolves to a short line for the player, or null.
 */
export async function recordWood(setId: string, cycle: number, r: RunnerResult): Promise<string | null> {
  const out = await db.transaction('rw', db.attempts, db.woodSets, async () => {
    const set = await db.woodSets.get(setId);
    // Gone or closed elsewhere: nothing can be stored, which is not the same as "already stored".
    if (!isUsableSet(set) || !canRecord(set, cycle, r.puzzle.id)) throw new Error('This cycle can no longer take results.');
    const existing = await db.attempts.where('mode').equals('woodpecker').filter((a) => a.setId === setId && a.cycle === cycle).toArray();
    const plan = planRecord(set, cycle, existing, r.puzzle.id);
    if (!plan.write) return null;
    const now = Date.now();
    await db.attempts.add({
      puzzleId: r.puzzle.id,
      mode: 'woodpecker',
      solved: r.solved,
      puzzleRating: r.puzzle.rating,
      hintsUsed: r.hintsUsed,
      timeMs: capMs(r.timeMs),
      at: now,
      themes: r.puzzle.themes,
      setId,
      cycle,
    });
    if (plan.finishes) {
      await db.woodSets.put({ ...set, cycles: set.cycles.map((c) => (c.n === cycle ? { ...c, finishedAt: now } : c)) });
    }
    return { finished: plan.finishes };
  });
  if (!out) return null;
  if (out.finished) return `Cycle ${cycle} done`;
  return r.solved && r.hintsUsed === 0 ? null : 'Counted as a miss. You can replay it from the set page.';
}

/** Starts the next cycle when the current one is finished. False when it is not allowed. */
export async function startNext(setId: string): Promise<boolean> {
  return db.transaction('rw', db.woodSets, async () => {
    const set = await db.woodSets.get(setId);
    if (!isUsableSet(set)) return false;
    const next = startNextCycle(set, Date.now());
    if (next === set) return false;
    await db.woodSets.put(next);
    return true;
  });
}

/** Removes the set. Its attempts stay, because they count as activity. */
export async function deleteSet(id: string): Promise<void> {
  await db.woodSets.delete(id);
}

export async function renameSet(id: string, name: string): Promise<void> {
  await db.transaction('rw', db.woodSets, async () => {
    const set = await db.woodSets.get(id);
    if (!isUsableSet(set)) return;
    await db.woodSets.put({ ...set, name: cleanName(name, set.name) });
  });
}
