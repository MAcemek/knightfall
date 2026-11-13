import type { EvalScore, Side } from './types.ts';

/**
 * Win chance, accuracy and rating maths. The formulas are the published Lichess ones
 * (https://lichess.org/page/accuracy); the code is Knightfall's own.
 */

/** Centipawns are clamped to this before the win-chance curve (beyond it the curve is flat anyway). */
export const CP_CEILING = 1000;
const WIN_K = 0.00368208;

export function clampCp(cp: number): number {
  return Math.max(-CP_CEILING, Math.min(CP_CEILING, cp));
}

/** A score as clamped centipawns from White's view (mate = +/-CP_CEILING). */
export function scoreToCp(score: EvalScore): number {
  if ('mate' in score) return score.mate > 0 ? CP_CEILING : -CP_CEILING;
  return clampCp(score.cp);
}

/** White's win chance, 0..100. Mate for White = 100, mate for Black = 0. */
export function winPercent(score: EvalScore): number {
  if ('mate' in score) return score.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * clampCp(score.cp))) - 1);
}

/** Win chance of `side`, 0..100. */
export function winPercentFor(score: EvalScore, side: Side): number {
  const w = winPercent(score);
  return side === 'w' ? w : 100 - w;
}

/** Accuracy 0..100 of one move, from the mover's win chance before and after it. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const raw = 103.1668 * Math.exp(-0.04354 * (winBefore - winAfter)) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * Game accuracy of ONE side: the mean of (a) a volatility-weighted mean and (b) the harmonic mean of
 * that side's move accuracies. Sharp stretches of the game weigh more. Both means only ever see the
 * moves of `side` (each side has its own denominator).
 *
 * @param whiteWin    White's win chance for every position: moves + 1 entries (index 0 = start position).
 * @param side        whose accuracy to compute
 * @param firstMover  side to move in the start position
 * @returns 0..100, or null when that side made no move.
 */
export function gameAccuracy(whiteWin: readonly number[], side: Side, firstMover: Side = 'w'): number | null {
  const moves = whiteWin.length - 1;
  if (moves < 1) return null;
  const windowSize = Math.max(2, Math.min(8, Math.floor(moves / 10)));
  // One window per move: the first (windowSize - 2) moves reuse the first window, then the window slides.
  const windows: number[][] = [];
  const first = whiteWin.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize, whiteWin.length) - 2; i++) windows.push(first);
  for (let i = 0; i + windowSize <= whiteWin.length; i++) windows.push(whiteWin.slice(i, i + windowSize));
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))));

  const acc: number[] = [];
  const wts: number[] = [];
  for (let i = 0; i < moves; i++) {
    const whiteMoved = (i % 2 === 0) === (firstMover === 'w');
    const mover: Side = whiteMoved ? 'w' : 'b';
    if (mover !== side) continue;
    const before = whiteMoved ? whiteWin[i] : 100 - whiteWin[i];
    const after = whiteMoved ? whiteWin[i + 1] : 100 - whiteWin[i + 1];
    acc.push(moveAccuracy(before, after));
    wts.push(weights[Math.min(i, weights.length - 1)] ?? 1);
  }
  if (!acc.length) return null;
  const weighted = acc.reduce((s, a, i) => s + a * wts[i], 0) / wts.reduce((a, b) => a + b, 0);
  const harmonic = acc.length / acc.reduce((s, a) => s + 1 / Math.max(1, a), 0);
  return (weighted + harmonic) / 2;
}

/** Centipawns the mover lost with one move (>= 0). Scores are White-POV. */
export function centipawnLoss(before: EvalScore, after: EvalScore, mover: Side): number {
  const sign = mover === 'w' ? 1 : -1;
  return Math.max(0, sign * scoreToCp(before) - sign * scoreToCp(after));
}

/** Average centipawn loss, or null without moves. */
export function averageCpLoss(losses: readonly number[]): number | null {
  return losses.length ? mean(losses) : null;
}

/** Spread of single-game accuracy among players of one rating band. */
export interface AccuracyBand {
  /** Rating range [min, max). */
  min: number;
  max: number;
  /** 25th, 50th and 75th percentile of accuracy. */
  p25: number;
  p50: number;
  p75: number;
  /** Player-games behind the numbers. */
  n: number;
}

/**
 * Typical accuracy by Lichess rating, from 4,232 player-games of rated, Lichess-analysed blitz and rapid games
 * (2026-11, scripts/fit-rating.mjs). Bands with fewer than 80 player-games are left out.
 *
 * There is deliberately no "rating from accuracy" estimate: on the same data one game's accuracy explains only
 * about 10% of rating differences (median error ~350 points), so any such number mostly reflects the average.
 */
export const TYPICAL_ACCURACY: readonly AccuracyBand[] = [
  { min: 600, max: 800, p25: 55, p50: 66, p75: 79, n: 162 },
  { min: 800, max: 1000, p25: 61, p50: 72, p75: 82, n: 345 },
  { min: 1000, max: 1200, p25: 59, p50: 73, p75: 83, n: 390 },
  { min: 1200, max: 1400, p25: 67, p50: 76, p75: 84, n: 340 },
  { min: 1400, max: 1600, p25: 68, p50: 78, p75: 85, n: 631 },
  { min: 1600, max: 1800, p25: 70, p50: 79, p75: 87, n: 626 },
  { min: 1800, max: 2000, p25: 71, p50: 81, p75: 87, n: 559 },
  { min: 2000, max: 2200, p25: 73, p50: 80, p75: 88, n: 600 },
  { min: 2200, max: 2400, p25: 77, p50: 85, p75: 91, n: 386 },
];

/** The band a Lichess rating falls in; null when unknown or outside the calibrated range. */
export function typicalAccuracy(rating: number | null | undefined): AccuracyBand | null {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return null;
  return TYPICAL_ACCURACY.find((b) => rating >= b.min && rating < b.max) ?? null;
}

/** "+0.35", "-1.20", "M5", "-M3" (White's view). Checkmate on the board is "#". */
export function formatScore(score: EvalScore, checkmate = false): string {
  if (checkmate) return '#';
  if ('mate' in score) return `${score.mate < 0 ? '-' : ''}M${Math.abs(score.mate)}`;
  const pawns = score.cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
