import type { EvalScore, Side } from './types.ts';

/**
 * Expected points: the share of a point (0..1) White is expected to score from a position, the model the
 * classification and accuracy below are built on. Constants follow WintrChess's published behaviour
 * (reimplemented here; no code copied).
 */

/** Logistic slope per centipawn. */
export const EP_GRADIENT = 0.0035;

/**
 * Expected points for White. A mate score maps to 1 or 0. A terminal checkmate is attributed to `mover`,
 * the side that just moved (only used when a score of mate 0 is passed).
 */
export function expectedPoints(score: EvalScore, mover: Side = 'w'): number {
  if ('mate' in score) {
    if (score.mate === 0) return mover === 'w' ? 1 : 0;
    return score.mate > 0 ? 1 : 0;
  }
  return 1 / (1 + Math.exp(-EP_GRADIENT * score.cp));
}

/**
 * Expected points the mover gave away between `before` (position before the move) and `after`, never
 * negative. Both scores are White's view.
 */
export function expectedPointsLoss(before: EvalScore, after: EvalScore, mover: Side): number {
  const other: Side = mover === 'w' ? 'b' : 'w';
  const diff = expectedPoints(before, other) - expectedPoints(after, mover);
  return Math.max(0, diff * (mover === 'w' ? 1 : -1));
}

/** The raw score value (cp or mate count) from `side`'s point of view. */
export function subjectiveValue(score: EvalScore, side: Side): number {
  const v = 'mate' in score ? score.mate : score.cp;
  return side === 'w' ? v : -v;
}

/** Per-move accuracy from expected-points loss: 103.16·e^(−4·loss) − 3.17 (not clamped). */
export function epMoveAccuracy(loss: number): number {
  return 103.16 * Math.exp(-4 * loss) - 3.17;
}
