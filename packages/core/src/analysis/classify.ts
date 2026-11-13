import { isSacrifice } from './sacrifice.ts';
import type { MoveClass, PositionEval, Side } from './types.ts';
import { winPercentFor } from './winning.ts';

/** Win-chance drop thresholds (percentage points lost by the mover). */
export const DROP_EXCELLENT = 2;
export const DROP_GOOD = 5;
export const DROP_INACCURACY = 10;
export const DROP_MISTAKE = 20;
/** "great": the best move must beat the second-best line by more than this. */
export const GREAT_GAP = 10;
/** "brilliant" is not awarded when the mover was already winning by more than this. */
export const BRILLIANT_MAX_WIN = 97;
/** "miss": the mover must still be at least this well off afterwards (otherwise it is a mistake/blunder). */
export const MISS_MIN_WIN = 45;

export interface ClassifyContext {
  fenBefore: string;
  /** The move played (UCI). */
  uci: string;
  mover: Side;
  /** Position before the move, MultiPV >= 2 where the position has two legal moves. */
  before: PositionEval;
  /** Position after the move. */
  after: PositionEval;
  /** The position after the move is in the opening table. */
  isBook: boolean;
  /** Number of legal moves in the position before the move. */
  legalMoves: number;
  /** Class of the opponent's previous move (undefined for the first move). */
  previous?: MoveClass;
}

/** Plain win-chance table: <= 2 excellent, <= 5 good, <= 10 inaccuracy, <= 20 mistake, else blunder. */
export function classByDrop(drop: number): MoveClass {
  if (drop <= DROP_EXCELLENT) return 'excellent';
  if (drop <= DROP_GOOD) return 'good';
  if (drop <= DROP_INACCURACY) return 'inaccuracy';
  if (drop <= DROP_MISTAKE) return 'mistake';
  return 'blunder';
}

/**
 * Classify one move. Checks run in this order and the first hit wins:
 *  1. book       the resulting position is in the opening table
 *  2. forced     it was the only legal move
 *  3. brilliant  a sound sacrifice: drop <= 2, isSacrifice(), mover was not already winning (> 97)
 *                and is not worse afterwards (>= 50)
 *  4. great      the engine's first choice, and the second line is worse by more than 10
 *  5. best       the engine's first choice
 *  6. miss       the opponent's previous move was a mistake/blunder/miss, this move drops more than 10,
 *                and the mover is still >= 45 afterwards (the chance was wasted, the game was not thrown)
 *  7. otherwise  the win-chance table (excellent / good / inaccuracy / mistake / blunder)
 */
export function classifyMove(ctx: ClassifyContext): MoveClass {
  if (ctx.isBook) return 'book';
  if (ctx.legalMoves <= 1) return 'forced';

  const winBefore = winPercentFor(ctx.before.score, ctx.mover);
  const winAfter = winPercentFor(ctx.after.score, ctx.mover);
  const drop = Math.max(0, winBefore - winAfter);
  const top = ctx.before.lines[0];
  const second = ctx.before.lines[1];
  const playedBest = !!top && top.pv[0] === ctx.uci;

  if (drop <= DROP_EXCELLENT && winBefore <= BRILLIANT_MAX_WIN && winAfter >= 50 && isSacrifice(ctx.fenBefore, ctx.uci)) return 'brilliant';
  if (playedBest) {
    if (second && winPercentFor(top.score, ctx.mover) - winPercentFor(second.score, ctx.mover) > GREAT_GAP) return 'great';
    return 'best';
  }
  const gifted = ctx.previous === 'mistake' || ctx.previous === 'blunder' || ctx.previous === 'miss';
  if (gifted && drop > DROP_INACCURACY && winAfter >= MISS_MIN_WIN) return 'miss';
  return classByDrop(drop);
}
