import type { Puzzle } from '@knightfall/core';
import type { RushMode, RushRun } from '../../shared/db.ts';

/** Pure Puzzle Rush rules: modes, scoring/combo/strike bookkeeping and run summaries. */

export const MAX_STRIKES = 3;
/** Combo at which the glowing "×N" badge appears. */
export const COMBO_BADGE_AT = 5;
/** Every N combo triggers a milestone burst. */
export const MILESTONE_EVERY = 5;
/** Under this many ms the clock turns red and ticks. */
export const DANGER_MS = 10_000;

export interface RushModeConfig {
  id: RushMode;
  label: string;
  /** Short label for chips/hotkeys. */
  short: string;
  /** Clock length, or null for Survival (no clock). */
  durationMs: number | null;
  blurb: string;
  /** Difficulty ramp passed to sequencePuzzle. */
  ramp: { start: number; step: number };
}

export const RUSH_MODES: Record<RushMode, RushModeConfig> = {
  '3min': {
    id: '3min',
    label: '3 Minutes',
    short: '3 Min',
    durationMs: 3 * 60_000,
    blurb: 'A sprint. Three minutes, three strikes.',
    ramp: { start: 500, step: 40 },
  },
  '5min': {
    id: '5min',
    label: '5 Minutes',
    short: '5 Min',
    durationMs: 5 * 60_000,
    blurb: 'More time to climb into harder puzzles.',
    ramp: { start: 500, step: 35 },
  },
  survival: {
    id: 'survival',
    label: 'Survival',
    short: 'Survival',
    durationMs: null,
    blurb: 'No clock. Go as far as you can before three strikes.',
    ramp: { start: 500, step: 50 },
  },
};

export const MODE_ORDER: RushMode[] = ['3min', '5min', 'survival'];

export function isRushMode(x: string | undefined | null): x is RushMode {
  return x === '3min' || x === '5min' || x === 'survival';
}

export interface RushAttempt {
  /** Position in the run's sequence (0-based). */
  index: number;
  puzzle: Puzzle;
  solved: boolean;
  timeMs: number;
}

export interface RunCore {
  score: number;
  combo: number;
  bestCombo: number;
  strikes: number;
  attempts: RushAttempt[];
}

export function initialCore(): RunCore {
  return { score: 0, combo: 0, bestCombo: 0, strikes: 0, attempts: [] };
}

export interface ApplyOutcome {
  core: RunCore;
  /** Combo just reached a multiple of MILESTONE_EVERY. */
  milestone: boolean;
  /** This miss was the final strike. */
  struckOut: boolean;
}

/** Fold one puzzle outcome into the run. Pure. */
export function applyResult(core: RunCore, attempt: RushAttempt): ApplyOutcome {
  const attempts = [...core.attempts, attempt];
  if (attempt.solved) {
    const combo = core.combo + 1;
    return {
      core: { ...core, score: core.score + 1, combo, bestCombo: Math.max(core.bestCombo, combo), attempts },
      milestone: combo % MILESTONE_EVERY === 0,
      struckOut: false,
    };
  }
  const strikes = Math.min(MAX_STRIKES, core.strikes + 1);
  return {
    core: { ...core, combo: 0, strikes, attempts },
    milestone: false,
    struckOut: strikes >= MAX_STRIKES,
  };
}

export interface RunSummary {
  attempted: number;
  solved: number;
  /** 0..1, or null if nothing was attempted. */
  accuracy: number | null;
  avgTimeMs: number | null;
  highestSolved: number | null;
  bestCombo: number;
}

export function summarize(core: RunCore): RunSummary {
  const { attempts } = core;
  const solved = attempts.filter((a) => a.solved);
  return {
    attempted: attempts.length,
    solved: solved.length,
    accuracy: attempts.length ? solved.length / attempts.length : null,
    avgTimeMs: attempts.length ? attempts.reduce((s, a) => s + a.timeMs, 0) / attempts.length : null,
    highestSolved: solved.length ? Math.max(...solved.map((a) => a.puzzle.rating)) : null,
    bestCombo: core.bestCombo,
  };
}

/**
 * m:ss clock. Countdowns round up (so "0:01" shows until the very end); elapsed clocks round down.
 */
export function formatClock(ms: number, dir: 'down' | 'up' = 'down'): string {
  const total = Math.max(0, dir === 'down' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSeconds(ms: number | null): string {
  if (ms === null) return '–';
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export interface ModeHistory {
  best: number | null;
  /** Most recent scores first (max 5). */
  last: number[];
  runs: number;
}

/** Personal best + recent scores for one mode. `runs` may be in any order. */
export function modeHistory(runs: RushRun[], mode: RushMode): ModeHistory {
  const mine = runs.filter((r) => r.mode === mode).sort((a, b) => b.at - a.at);
  return {
    best: mine.length ? Math.max(...mine.map((r) => r.score)) : null,
    last: mine.slice(0, 5).map((r) => r.score),
    runs: mine.length,
  };
}

export function toRushRun(mode: RushMode, core: RunCore, at: number): RushRun {
  const s = summarize(core);
  return {
    mode,
    score: core.score,
    strikes: core.strikes,
    bestCombo: core.bestCombo,
    highestRating: s.highestSolved ?? 0,
    puzzles: core.attempts.map((a) => ({ id: a.puzzle.id, rating: a.puzzle.rating, solved: a.solved })),
    at,
  };
}
