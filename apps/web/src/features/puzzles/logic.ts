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

/** "advancedPawn" → "Advanced pawn", "mateIn2" → "Mate in 2". */
export function themeLabel(theme: string): string {
  const words = theme
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Themes that only describe length/phase and are less interesting to show first. */
const LOW_PRIORITY = new Set(['short', 'long', 'veryLong', 'oneMove', 'middlegame', 'endgame', 'opening', 'master', 'masterVsMaster', 'superGM', 'crushing', 'advantage', 'equality']);

/** Sort themes so tactical motifs (fork, pin, mate…) come before length/phase tags. */
export function sortThemes(themes: string[]): string[] {
  return [...themes].sort((a, b) => Number(LOW_PRIORITY.has(a)) - Number(LOW_PRIORITY.has(b)));
}

/** Glicko RD above this reads as "provisional". */
export const PROVISIONAL_RD = 110;
