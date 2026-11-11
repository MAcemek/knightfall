import { useCallback, useEffect, useRef, useState } from 'react';
import { bucketFor, BUCKET_SIZE, type Glicko, type Puzzle } from '@knightfall/core';
import { db, defaults, getKV, KEYS, setKV, type Attempt, type StreakState } from '../../shared/db.ts';
import { loadBucket, prefetchAround, puzzleNear } from '../../shared/puzzleSource.ts';
import type { RunnerResult } from '../../shared/PuzzlePlayer/index.ts';
import { nextStreak, ratedOutcome, type StreakStep } from './logic.ts';

/** How the current puzzle counts. */
export type SessionMode = 'rated' | 'replay';

export type ResultKind = 'gain' | 'loss' | 'hinted' | 'replay-solved' | 'replay-failed';

export interface PuzzleResult {
  kind: ResultKind;
  solved: boolean;
  delta: number;
  ratingAfter?: number;
}

export interface StreakEvent extends StreakStep {
  key: number;
}

const RECENT_LIMIT = 200;

/** A rated puzzle that was shown but has no outcome yet. */
interface PendingRated {
  puzzleId: string;
  puzzleRating: number;
  themes?: string[];
  at: number;
}

/**
 * Apply one rated result (rating, streak, Attempt row) atomically. If a pending marker exists for
 * `puzzleId` it is cleared in the same transaction, so a result is never applied twice.
 */
async function applyRated(r: { puzzleId: string; puzzleRating: number; solved: boolean; hintsUsed: number; timeMs: number; themes?: string[] }) {
  return db.transaction('rw', db.kv, db.attempts, async () => {
    const player = await getKV<Glicko>(KEYS.puzzleRating, defaults.puzzleRating);
    const streak = await getKV<StreakState>(KEYS.puzzleStreak, defaults.puzzleStreak);
    const rated = ratedOutcome(player, r.puzzleRating, r.solved, r.hintsUsed);
    const step = nextStreak(streak, r.solved, rated.clean);
    if (rated.applied) await setKV(KEYS.puzzleRating, rated.next);
    if (step.streak !== streak) await setKV(KEYS.puzzleStreak, step.streak);
    const pending = await getKV<PendingRated | null>(KEYS.ratedPending, null);
    if (pending?.puzzleId === r.puzzleId) await setKV<PendingRated | null>(KEYS.ratedPending, null);
    const attempt: Attempt = {
      puzzleId: r.puzzleId,
      mode: 'rated',
      solved: r.solved,
      puzzleRating: r.puzzleRating,
      ratingBefore: Math.round(player.rating),
      ratingAfter: Math.round(rated.next.rating),
      delta: rated.delta,
      hintsUsed: r.hintsUsed,
      timeMs: r.timeMs,
      at: Date.now(),
      themes: r.themes,
    };
    await db.attempts.add(attempt);
    return { rated, step };
  });
}

/**
 * Settle an abandoned rated puzzle (left mid-solve via navigation, reload or closing the tab) as a miss.
 * Returns the rating change applied, or null if nothing was pending.
 */
export async function settleAbandoned(): Promise<number | null> {
  const pending = await getKV<PendingRated | null>(KEYS.ratedPending, null);
  if (!pending) return null;
  const { rated } = await applyRated({ ...pending, solved: false, hintsUsed: 0, timeMs: Date.now() - pending.at });
  return rated.delta;
}

/**
 * Rated-puzzle session: picks puzzles near the player's Glicko rating, applies the rating/streak
 * rules on the first outcome, writes Attempt rows, and prefetches the next puzzle.
 */
export function useRatedSession() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [mode, setMode] = useState<SessionMode>('rated');
  const [result, setResult] = useState<PuzzleResult | null>(null);
  const [streakEvent, setStreakEvent] = useState<StreakEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Rating change from a previously abandoned puzzle that was just settled as a miss. */
  const [abandonedDelta, setAbandonedDelta] = useState<number | null>(null);

  const modeRef = useRef<SessionMode>('rated');
  const recent = useRef<Set<string>>(new Set());
  const seen = useRef<Map<string, Puzzle>>(new Map());
  const nextRef = useRef<Promise<Puzzle> | null>(null);
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());
  const loadSeq = useRef(0);
  const eventKey = useRef(0);
  /** A rated puzzle was shown during this mount and has no outcome yet. */
  const unfinished = useRef(false);
  const settledDelta = useRef<number | null>(null);

  const show = useCallback((p: Puzzle, m: SessionMode) => {
    seen.current.set(p.id, p);
    recent.current.add(p.id);
    modeRef.current = m;
    setMode(m);
    setResult(null);
    // Rated puzzles count from the moment they are shown: leaving before an outcome is a miss.
    unfinished.current = m === 'rated';
    if (m === 'rated') {
      const mark: PendingRated = { puzzleId: p.id, puzzleRating: p.rating, themes: p.themes, at: Date.now() };
      writeChain.current = writeChain.current.then(() => setKV(KEYS.ratedPending, mark)).catch(() => {});
    }
    // Always a fresh object so the runner resets even if the same puzzle comes back.
    setPuzzle({ ...p });
  }, []);

  const fetchNext = useCallback(async (): Promise<Puzzle> => {
    const rating = (await getKV<Glicko>(KEYS.puzzleRating, defaults.puzzleRating)).rating;
    prefetchAround(rating);
    return puzzleNear(rating, recent.current);
  }, []);

  const next = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      // Let the previous result land first so the next pick uses the updated rating.
      await writeChain.current;
      const pending = nextRef.current;
      nextRef.current = null;
      let p = pending ? await pending.catch(() => null) : null;
      if (!p || recent.current.has(p.id)) p = await fetchNext();
      if (seq !== loadSeq.current) return;
      show(p, 'rated');
    } catch (e) {
      if (seq === loadSeq.current) setError((e as Error).message || 'Could not load a puzzle.');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [fetchNext, show]);

  // First load: remember recently attempted ids so we don't repeat them.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await db.attempts.orderBy('at').reverse().limit(RECENT_LIMIT).toArray();
        for (const r of rows) recent.current.add(r.puzzleId);
      } catch {
        /* first run or private mode: start fresh */
      }
      // A puzzle left unfinished last time (reload / closed tab) counts as a miss.
      const settle = writeChain.current.then(settleAbandoned);
      writeChain.current = settle.catch(() => {});
      const delta = await settle.catch(() => null);
      // Kept in a ref so the notice survives React StrictMode's dev unmount/remount.
      if (delta !== null) settledDelta.current = delta;
      if (!alive) return;
      if (settledDelta.current !== null) setAbandonedDelta(settledDelta.current);
      settledDelta.current = null;
      void next();
    })();
    return () => {
      alive = false;
      // Navigating away inside the app mid-puzzle: settle it right away. (Only for a puzzle shown during
      // this mount, so React StrictMode's dev remount doesn't silently settle a leftover from a reload.)
      if (unfinished.current) writeChain.current = writeChain.current.then(settleAbandoned).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onComplete = useCallback(
    (r: RunnerResult) => {
      if (modeRef.current === 'replay') {
        setResult({ kind: r.solved ? 'replay-solved' : 'replay-failed', solved: r.solved, delta: 0 });
        return;
      }
      setAbandonedDelta(null);
      unfinished.current = false;
      const job = writeChain.current.then(async () => {
        const { rated, step } = await applyRated({
          puzzleId: r.puzzle.id,
          puzzleRating: r.puzzle.rating,
          solved: r.solved,
          hintsUsed: r.hintsUsed,
          timeMs: r.timeMs,
          themes: r.puzzle.themes,
        });
        setResult({
          kind: !r.solved ? 'loss' : rated.applied ? 'gain' : 'hinted',
          solved: r.solved,
          delta: rated.delta,
          ratingAfter: Math.round(rated.next.rating),
        });
        setStreakEvent({ ...step, key: ++eventKey.current });
        // Warm up the next puzzle at the new rating.
        nextRef.current = puzzleNear(rated.next.rating, recent.current);
        nextRef.current.catch(() => {});
      });
      writeChain.current = job.catch((e) => {
        console.error('Failed to record attempt', e);
        setError('Could not save your result.');
      });
    },
    [],
  );

  /** Replay a puzzle from history (unrated). */
  const replay = useCallback(
    async (puzzleId: string, puzzleRating: number) => {
      const seq = ++loadSeq.current;
      setError(null);
      let p = seen.current.get(puzzleId) ?? null;
      if (!p) {
        setLoading(true);
        const b = bucketFor(puzzleRating);
        for (const bucket of [b, b - BUCKET_SIZE, b + BUCKET_SIZE]) {
          try {
            p = (await loadBucket(bucket)).find((x) => x.id === puzzleId) ?? null;
          } catch {
            p = null;
          }
          if (p) break;
        }
        if (seq !== loadSeq.current) return;
        setLoading(false);
      }
      if (!p) {
        setError('That puzzle is no longer in the local puzzle set.');
        return;
      }
      show(p, 'replay');
    },
    [show],
  );

  return { puzzle, mode, result, streakEvent, error, loading, abandonedDelta, next, replay, onComplete };
}
