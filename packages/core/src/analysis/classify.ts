import { Chess, type Move } from 'chess.js';
import { uciToMove } from '../validate.ts';
import { expectedPoints, expectedPointsLoss, subjectiveValue } from './expectedPoints.ts';
import {
  attackingMoves,
  captureSquare,
  hasDangerLevels,
  isPieceSafe,
  isPieceTrapped,
  unsafePieces,
} from './pieceSafety.ts';
import type { EngineLine, EvalScore, MoveClass, PositionEval, Side } from './types.ts';

/**
 * Move classification by expected-points loss, matching WintrChess's rules (reimplemented from its documented
 * behaviour, no code copied). Knightfall's names: great = "critical"/only move, good = "okay", book = "theory".
 * On top of those rules Knightfall adds "miss" (a chance the opponent gave you and you let go), which never
 * changes accuracy.
 */

/** Expected-points loss bands (exclusive upper bounds). */
export const LOSS_BEST = 0.01;
export const LOSS_EXCELLENT = 0.045;
export const LOSS_GOOD = 0.08;
export const LOSS_INACCURACY = 0.12;
export const LOSS_MISTAKE = 0.22;
/** "great": the second-best move would have lost at least this much. */
export const GREAT_SECOND_LOSS = 0.1;
/** Positions this good (cp, mover's view) need no hard-to-find move. */
export const STILL_WINNING_CP = 700;
/** "miss": the mover must still be at least this well off afterwards (expected points). */
export const MISS_MIN_EP = 0.45;

/** Rank for "at least as good as": blunder 0 … best/great/brilliant/forced/book 5. */
export const CLASS_RANK: Record<MoveClass, number> = {
  blunder: 0, miss: 0, mistake: 1, inaccuracy: 2, good: 3, excellent: 4,
  best: 5, great: 5, brilliant: 5, forced: 5, book: 5,
};

export interface ClassifyContext {
  fenBefore: string;
  fenAfter: string;
  /** The move played (UCI). */
  uci: string;
  mover: Side;
  /** Position before the move (2 engine lines where it has two legal moves). */
  before: PositionEval;
  /** Position after the move. */
  after: PositionEval;
  /** The position after the move is a known opening position. */
  isBook: boolean;
  /** Class of the opponent's previous move (undefined for the first move). */
  previous?: MoveClass;
}

const isMate = (s: EvalScore): s is { mate: number } => 'mate' in s;

/** The class from the loss alone (also handles positions with forced mates). */
export function pointLossClass(before: EvalScore, after: EvalScore, mover: Side): MoveClass {
  const prev = subjectiveValue(before, mover);
  const cur = subjectiveValue(after, mover);
  if (isMate(before) && isMate(after)) {
    if (prev > 0 && cur < 0) return cur < -3 ? 'mistake' : 'blunder';
    const mateLoss = (after.mate - before.mate) * (mover === 'w' ? 1 : -1);
    if (mateLoss < 0 || (mateLoss === 0 && cur < 0)) return 'best';
    if (mateLoss < 2) return 'excellent';
    if (mateLoss < 7) return 'good';
    return 'inaccuracy';
  }
  if (isMate(before)) {
    if (cur >= 800) return 'excellent';
    if (cur >= 400) return 'good';
    if (cur >= 200) return 'inaccuracy';
    if (cur >= 0) return 'mistake';
    return 'blunder';
  }
  if (isMate(after)) {
    if (cur > 0) return 'best';
    if (cur >= -2) return 'blunder';
    if (cur >= -5) return 'mistake';
    return 'inaccuracy';
  }
  const loss = expectedPointsLoss(before, after, mover);
  if (loss < LOSS_BEST) return 'best';
  if (loss < LOSS_EXCELLENT) return 'excellent';
  if (loss < LOSS_GOOD) return 'good';
  if (loss < LOSS_INACCURACY) return 'inaccuracy';
  if (loss < LOSS_MISTAKE) return 'mistake';
  return 'blunder';
}

function play(fen: string, uci: string): { before: Chess; after: Chess; move: Move } | null {
  try {
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move(uciToMove(uci));
    return { before, after, move };
  } catch {
    return null;
  }
}

function secondLine(ev: PositionEval): EngineLine | undefined {
  return ev.lines[1];
}

/** A move that might deserve "great" or "brilliant": the position was not already won or lost, not in check. */
function isCandidate(ctx: ClassifyContext, move: Move, inCheckBefore: boolean): boolean {
  const second = secondLine(ctx.before);
  const after = ctx.after.score;
  if (second) {
    if (!isMate(second.score) && subjectiveValue(second.score, ctx.mover) >= STILL_WINNING_CP) return false;
  } else if (!isMate(after) && subjectiveValue(after, ctx.mover) >= STILL_WINNING_CP) return false;
  if (subjectiveValue(after, ctx.mover) < 0) return false;
  if (move.promotion === 'q') return false;
  if (inCheckBefore) return false;
  return true;
}

/** "great": the only move that keeps the advantage (the second-best loses >= 0.10 expected points). */
function isGreat(ctx: ClassifyContext, p: { before: Chess; move: Move }): boolean {
  if (!isCandidate(ctx, p.move, p.before.isCheck())) return false;
  const after = ctx.after.score;
  if (isMate(after) && subjectiveValue(after, ctx.mover) > 0) return false; // finding a mate is not "great"
  if (p.move.captured) {
    const victim = { color: ctx.mover === 'w' ? 'b' : 'w', square: captureSquare(p.move), type: p.move.captured } as const;
    if (!isPieceSafe(ctx.fenBefore, victim)) return false; // taking free material is easy
  }
  const second = secondLine(ctx.before);
  if (!second) return false;
  return expectedPointsLoss(ctx.before.score, second.score, ctx.mover) >= GREAT_SECOND_LOSS;
}

/** "brilliant": a sound sacrifice — leaves a piece en prise that the opponent cannot safely take. */
function isBrilliant(ctx: ClassifyContext, p: { before: Chess; after: Chess; move: Move }): boolean {
  if (!isCandidate(ctx, p.move, p.before.isCheck())) return false;
  if (p.move.promotion) return false;
  const color = ctx.mover;
  const prevUnsafe = unsafePieces(ctx.fenBefore, color);
  const unsafe = unsafePieces(ctx.fenAfter, color, p.move);
  if (!p.after.isCheck() && unsafe.length < prevUnsafe.length) return false; // moved a piece to safety
  const protectedByThreats = unsafe.every((piece) => hasDangerLevels(ctx.fenAfter, piece, attackingMoves(ctx.fenAfter, piece, false)));
  if (protectedByThreats) return false;
  const prevTrapped = prevUnsafe.filter((piece) => isPieceTrapped(ctx.fenBefore, piece));
  const trapped = unsafe.filter((piece) => isPieceTrapped(ctx.fenAfter, piece));
  const movedWasTrapped = prevTrapped.some((piece) => piece.square === p.move.from);
  if (trapped.length === unsafe.length || movedWasTrapped || trapped.length < prevTrapped.length) return false;
  return unsafe.length > 0;
}

/**
 * Classify one move. In order:
 *  1. forced     the only legal move
 *  2. book       the position after the move is a known opening position
 *  3. best       it gives checkmate
 *  4. best       the engine's first choice, otherwise the expected-points-loss bands
 *                (< 0.01 best, < 0.045 excellent, < 0.08 good, < 0.12 inaccuracy, < 0.22 mistake, else blunder;
 *                mate scores use mate-distance rules)
 *  5. great      the first choice and the only one that holds (second-best loses >= 0.10)
 *  6. brilliant  at least "best" and a sound sacrifice
 *  7. miss       Knightfall: the opponent just made a mistake/blunder and this move is an inaccuracy or worse
 *                while the mover is still doing fine
 */
export function classifyMove(ctx: ClassifyContext): MoveClass {
  const p = play(ctx.fenBefore, ctx.uci);
  if (!p) return pointLossClass(ctx.before.score, ctx.after.score, ctx.mover);
  if (p.before.moves().length <= 1) return 'forced';
  if (ctx.isBook) return 'book';
  if (p.after.isCheckmate()) return 'best';

  const top = ctx.before.lines[0];
  const topPlayed = !!top && top.pv[0] === ctx.uci;
  let cls: MoveClass = topPlayed ? 'best' : pointLossClass(ctx.before.score, ctx.after.score, ctx.mover);
  if (topPlayed && isGreat(ctx, p)) cls = 'great';
  if (CLASS_RANK[cls] >= CLASS_RANK.best && isBrilliant(ctx, p)) cls = 'brilliant';

  if (
    (ctx.previous === 'mistake' || ctx.previous === 'blunder') &&
    (cls === 'inaccuracy' || cls === 'mistake' || cls === 'blunder')
  ) {
    const ep = expectedPoints(ctx.after.score, ctx.mover);
    const moverEp = ctx.mover === 'w' ? ep : 1 - ep;
    if (moverEp >= MISS_MIN_EP) cls = 'miss';
  }
  return cls;
}
