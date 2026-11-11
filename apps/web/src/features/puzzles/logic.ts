import { puzzleRatingChange, type Glicko } from '@knightfall/core';
import type { StreakState } from '../../shared/db.ts';

/** Pure rules for rated puzzles (no React, no IndexedDB) so they are easy to unit-test. */

export interface RatedOutcome {
  /** Glicko to persist (unchanged when no rating applies). */
  next: Glicko;
  /** Rounded change shown to the player. */
  delta: number;
  /** Whether the rating actually moved (false for hinted solves). */
  applied: boolean;
  /** A clean solve: first try, no hints. */
  clean: boolean;
}

/**
 * Rating rules:
 *  - clean solve      → Glicko gain
 *  - solve with hints → no change (delta 0)
 *  - failure          → Glicko loss (always applied, hints or not)
 */
export function ratedOutcome(player: Glicko, puzzleRating: number, solved: boolean, hintsUsed: number): RatedOutcome {
  if (solved && hintsUsed > 0) return { next: player, delta: 0, applied: false, clean: false };
  const { next, delta } = puzzleRatingChange(player, puzzleRating, solved);
  return { next, delta, applied: true, clean: solved };
}

export interface StreakStep {
  streak: StreakState;
  /** +1 happened. */
  incremented: boolean;
  /** Streak was broken (was > 0, now 0). */
  broken: boolean;
  /** Multiple of 5 reached by this increment. */
  milestone: boolean;
  /** Current passed the previous best (only celebrated from 3 upward to avoid noise on a fresh profile). */
  newBest: boolean;
}

/** Solve-streak transition: +1 on clean solve, reset on fail, unchanged on a hinted solve. */
export function nextStreak(prev: StreakState, solved: boolean, clean: boolean): StreakStep {
  if (!solved) {
    return { streak: { current: 0, best: prev.best }, incremented: false, broken: prev.current > 0, milestone: false, newBest: false };
  }
  if (!clean) return { streak: prev, incremented: false, broken: false, milestone: false, newBest: false };
  const current = prev.current + 1;
  const best = Math.max(prev.best, current);
  return {
    streak: { current, best },
    incremented: true,
    broken: false,
    milestone: current % 5 === 0,
    newBest: current > prev.best && current >= 3,
  };
}

// Theme helpers live in shared/themes.ts (also used by Train and Stats); re-exported for existing imports.
export { sortThemes, themeLabel } from '../../shared/themes.ts';

/** Glicko RD above this reads as "provisional". */
export const PROVISIONAL_RD = 110;
