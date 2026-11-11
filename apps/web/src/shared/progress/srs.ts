import type { ReviewItem } from '../db.ts';

/** Pure spaced-repetition rules for the "Review mistakes" queue (Leitner boxes). No React, no IndexedDB. */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Wait before a puzzle in box N is due again. Box 0 = just missed. */
export const REVIEW_INTERVALS_MS: readonly number[] = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
export const REVIEW_MAX_BOX = REVIEW_INTERVALS_MS.length - 1;

/** A puzzle that was just missed for the first time. */
export function newReview(src: { puzzleId: string; puzzleRating: number; themes?: string[] }, now: number): ReviewItem {
  return {
    puzzleId: src.puzzleId,
    puzzleRating: src.puzzleRating,
    themes: src.themes,
    box: 0,
    due: now + REVIEW_INTERVALS_MS[0],
    addedAt: now,
    lastAt: null,
    lapses: 0,
    reps: 0,
  };
}

/** The puzzle was missed again (in review or anywhere else): back to box 0. */
export function lapseReview(item: ReviewItem, now: number): ReviewItem {
  return { ...item, box: 0, due: now + REVIEW_INTERVALS_MS[0], lapses: item.lapses + 1 };
}

/**
 * Grade one review.
 *  - clean solve (no hints, no mistakes): up one box; a clean solve in the top box graduates (returns null → delete).
 *  - solved with help: stays in its box, due again tomorrow.
 *  - failed: lapse (box 0, due in 10 minutes).
 */
export function gradeReview(item: ReviewItem, r: { solved: boolean; clean: boolean }, now: number): ReviewItem | null {
  if (!r.solved) return { ...lapseReview(item, now), lastAt: now };
  if (!r.clean) return { ...item, due: now + DAY, lastAt: now };
  if (item.box >= REVIEW_MAX_BOX) return null;
  const box = item.box + 1;
  return { ...item, box, due: now + REVIEW_INTERVALS_MS[box], lastAt: now, reps: item.reps + 1 };
}

/** Items due at `now`, most overdue first. */
export function dueReviews(items: readonly ReviewItem[], now: number, limit = Infinity): ReviewItem[] {
  return items
    .filter((i) => i.due <= now)
    .sort((a, b) => a.due - b.due)
    .slice(0, limit);
}

export interface ReviewSummary {
  /** Due right now. */
  due: number;
  /** Everything in the queue. */
  total: number;
  /** When the next not-yet-due item becomes due (null if none is waiting). */
  nextDueAt: number | null;
}

export function reviewSummary(items: readonly ReviewItem[], now: number): ReviewSummary {
  let due = 0;
  let nextDueAt: number | null = null;
  for (const i of items) {
    if (i.due <= now) due++;
    else if (nextDueAt === null || i.due < nextDueAt) nextDueAt = i.due;
  }
  return { due, total: items.length, nextDueAt };
}

/** "10 min", "3 h", "1 day", "16 days" — for "next review in …". */
export function formatInterval(ms: number): string {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))} h`;
  const d = Math.round(ms / DAY);
  return `${d} day${d === 1 ? '' : 's'}`;
}

export interface MissAttempt {
  id: number;
  puzzleId: string;
  puzzleRating: number;
  solved: boolean;
  mode: string;
  themes?: string[];
  at: number;
}

/** Modes whose misses feed the queue. 'review' grades itself; 'custom' puzzles are not in the puzzle set. */
const QUEUE_MODES: ReadonlySet<string> = new Set(['rated', 'rush', 'theme']);

/**
 * Fold new attempts (id ascending) into the queue. Returns only the rows to write.
 * A miss on a puzzle that is not queued adds it; a miss on a queued puzzle is a lapse. Solves are ignored.
 */
export function ingestAttempts(existing: ReadonlyMap<string, ReviewItem>, attempts: readonly MissAttempt[]): ReviewItem[] {
  const changed = new Map<string, ReviewItem>();
  for (const a of attempts) {
    if (a.solved || !QUEUE_MODES.has(a.mode)) continue;
    const cur = changed.get(a.puzzleId) ?? existing.get(a.puzzleId);
    changed.set(a.puzzleId, cur ? lapseReview(cur, a.at) : newReview(a, a.at));
  }
  return [...changed.values()];
}
