import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Puzzle } from '@knightfall/core';
import { db, getKV, KEYS, setKV, type ReviewItem } from '../db.ts';
import { dueReviews, gradeReview, ingestAttempts, reviewSummary, type ReviewSummary } from './srs.ts';

/** IndexedDB side of the review queue. The rules live in srs.ts. */

/** On the very first scan only the most recent attempts are considered, so an old profile is not flooded. */
const FIRST_SCAN_LIMIT = 300;

/**
 * Fold attempts written since the last scan into the review queue (misses in rated / rush / theme modes).
 * Idempotent: the cursor moves in the same transaction. Returns how many queue rows were written.
 */
export async function syncReviewQueue(): Promise<number> {
  return db.transaction('rw', db.kv, db.attempts, db.reviews, async () => {
    const cursor = await getKV<number>(KEYS.reviewCursor, 0);
    const all = await db.attempts.where('id').above(cursor).toArray();
    if (!all.length) return 0;
    const fresh = cursor === 0 ? all.slice(-FIRST_SCAN_LIMIT) : all;
    const ids = [...new Set(fresh.filter((a) => !a.solved).map((a) => a.puzzleId))];
    const existing = new Map<string, ReviewItem>();
    for (const row of await db.reviews.bulkGet(ids)) if (row) existing.set(row.puzzleId, row);
    const changed = ingestAttempts(
      existing,
      fresh.map((a) => ({ id: a.id ?? 0, puzzleId: a.puzzleId, puzzleRating: a.puzzleRating, solved: a.solved, mode: a.mode, themes: a.themes, at: a.at })),
    );
    if (changed.length) await db.reviews.bulkPut(changed);
    await setKV(KEYS.reviewCursor, all.reduce((m, a) => Math.max(m, a.id ?? 0), cursor));
    return changed.length;
  });
}

export interface ReviewOutcome {
  /** New queue state; null when the puzzle graduated or was not queued. */
  item: ReviewItem | null;
  /** The puzzle left the queue for good (clean solve in the top box). */
  graduated: boolean;
}

/** Grade one review-session result: reschedule (or graduate) the queue row and log an Attempt with mode 'review'. */
export async function recordReview(puzzle: Puzzle, r: { solved: boolean; hintsUsed: number; mistakes: number; timeMs: number }): Promise<ReviewOutcome> {
  const now = Date.now();
  return db.transaction('rw', db.reviews, db.attempts, async () => {
    const cur = await db.reviews.get(puzzle.id);
    let item: ReviewItem | null = null;
    let graduated = false;
    if (cur) {
      item = gradeReview(cur, { solved: r.solved, clean: r.solved && r.hintsUsed === 0 && r.mistakes === 0 }, now);
      if (item) await db.reviews.put(item);
      else {
        graduated = true;
        await db.reviews.delete(puzzle.id);
      }
    }
    await db.attempts.add({
      puzzleId: puzzle.id,
      mode: 'review',
      solved: r.solved,
      puzzleRating: puzzle.rating,
      hintsUsed: r.hintsUsed,
      timeMs: r.timeMs,
      at: now,
      themes: puzzle.themes,
    });
    return { item, graduated };
  });
}

/** Due queue rows, most overdue first. */
export async function listDueReviews(limit = 20, now = Date.now()): Promise<ReviewItem[]> {
  return dueReviews(await db.reviews.where('due').belowOrEqual(now).toArray(), now, limit);
}

export async function removeReview(puzzleId: string): Promise<void> {
  await db.reviews.delete(puzzleId);
}

/** Live queue counters (re-evaluated every 30 s so items become due without a reload). */
export function useReviewSummary(): ReviewSummary | undefined {
  const items = useLiveQuery(() => db.reviews.toArray(), []);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return items ? reviewSummary(items, Date.now()) : undefined;
}
