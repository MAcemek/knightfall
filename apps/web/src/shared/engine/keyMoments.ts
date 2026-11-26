import { expectedPointsLoss, LOSS_EXCELLENT, LOSS_INACCURACY, winPercent, type MoveClass, type PositionEval, type Side } from '@knightfall/core';

/**
 * Which positions of a reviewed game get a second, deeper look. Pure: it only reads the first-pass
 * evaluations. A position is worth a deeper look when it sits next to a move that cost real points, a move
 * that looked great or brilliant, or one of the biggest swings of the game. Each such move contributes the
 * position before it and the position after it, because the verdict compares the two.
 */

export const MAX_KEY_POSITIONS = 40;
/** Phones search slowly and the second pass is deep, so it gets fewer positions there. */
export const MOBILE_MAX_KEY_POSITIONS = 24;

/** How many positions the second pass may search on this kind of device. */
export function keyPositionCap(mobile: boolean): number {
  return mobile ? MOBILE_MAX_KEY_POSITIONS : MAX_KEY_POSITIONS;
}
export const KEY_SWINGS = 3;

export interface CriticalOptions {
  /** First-pass class of every move (index = ply). Without it, great and brilliant moves are not picked. */
  classes?: readonly (MoveClass | undefined)[];
  /** Most positions to return. Default MAX_KEY_POSITIONS. */
  maxPositions?: number;
  /** Expected-points loss from which a move counts. Default LOSS_EXCELLENT. */
  minLoss?: number;
  /** How many of the largest win-chance swings are added. Default KEY_SWINGS. */
  swings?: number;
}

function moverOf(fen: string): Side {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/**
 * Indexes into `fens` (and `evals`) of the positions to re-evaluate, most important first, without
 * repeats. Finished positions (mate, stalemate) are never returned.
 */
export function criticalPlies(
  fens: readonly string[],
  evals: readonly (PositionEval | undefined)[],
  opts: CriticalOptions = {},
): number[] {
  const cap = opts.maxPositions ?? MAX_KEY_POSITIONS;
  const minLoss = opts.minLoss ?? LOSS_EXCELLENT;
  const moves = Math.min(fens.length, evals.length) - 1;
  const rows: { ply: number; priority: number; loss: number; swing: number; picked: boolean }[] = [];
  for (let ply = 0; ply < moves; ply++) {
    const before = evals[ply];
    const after = evals[ply + 1];
    if (!before || !after) continue;
    const loss = expectedPointsLoss(before.score, after.score, moverOf(fens[ply]));
    const swing = Math.abs(winPercent(after.score) - winPercent(before.score)) / 100;
    const cls = opts.classes?.[ply];
    const picked = loss >= minLoss || cls === 'great' || cls === 'brilliant';
    rows.push({ ply, priority: loss, loss, swing, picked });
  }
  const biggest = rows
    .filter((r) => r.swing > 0)
    .sort((a, b) => b.swing - a.swing || a.ply - b.ply)
    .slice(0, opts.swings ?? KEY_SWINGS);
  for (const r of biggest) {
    r.picked = true;
    r.priority = Math.max(r.loss, r.swing);
  }
  const chosen = rows.filter((r) => r.picked).sort((a, b) => b.priority - a.priority || a.ply - b.ply);

  const out: number[] = [];
  const seen = new Set<number>();
  const usable = (i: number) => {
    const e = evals[i];
    return !!e && !e.terminal && e.source !== 'terminal';
  };
  for (const r of chosen) {
    // A move is judged from the position before it and the one after it: take both or neither, so the cap never leaves half a pair.
    const pair = [r.ply, r.ply + 1].filter((i) => usable(i) && !seen.has(i));
    if (out.length + pair.length > cap) continue;
    for (const i of pair) {
      seen.add(i);
      out.push(i);
    }
    if (out.length >= cap) break;
  }
  return out;
}

/** Of the wanted positions, those whose stored evaluation is shallower than `depth` (cloud evals may already be deep enough). */
export function positionsToRefine(evals: readonly (PositionEval | undefined)[], wanted: readonly number[], depth: number): number[] {
  return wanted.filter((i) => {
    const e = evals[i];
    return !!e && !e.terminal && e.source !== 'terminal' && e.depth < depth;
  });
}

/** Extra positions the consistency rounds may search after the second pass. */
export const MAX_EXTRA_POSITIONS = 12;
export const MOBILE_MAX_EXTRA_POSITIONS = 8;
/** Most consistency rounds after the second pass. */
export const MAX_EXTRA_ROUNDS = 3;
/** A boundary move is harmful only when mixing depths made it this much worse than the first pass. */
const BOUNDARY_MARGIN = 0.02;

export function extraPositionCap(mobile: boolean): number {
  return mobile ? MOBILE_MAX_EXTRA_POSITIONS : MAX_EXTRA_POSITIONS;
}

export interface HarmfulBoundary {
  /** The position that was searched deeper. */
  refined: number;
  /** The position of the same move that is still at first-pass depth. */
  unrefined: number;
  /** Expected-points loss of the move with the merged evaluations. */
  loss: number;
}

/**
 * Moves judged across two depths that look worse than they did in the first pass. A "boundary" move is one
 * where exactly one of the positions before and after it was searched deeper (`refined`). It is harmful when
 * its loss with the merged evaluations is at least LOSS_INACCURACY and more than 0.02 above its loss with the
 * first-pass evaluations of both positions. Worst first. Finished positions are never listed as unrefined
 * (their score is exact, so there is nothing to search).
 */
export function harmfulBoundaryMoves(
  fens: readonly string[],
  firstPass: readonly (PositionEval | undefined)[],
  merged: readonly (PositionEval | undefined)[],
  refined: ReadonlySet<number>,
): HarmfulBoundary[] {
  const moves = Math.min(fens.length, firstPass.length, merged.length) - 1;
  const out: HarmfulBoundary[] = [];
  for (let i = 0; i < moves; i++) {
    if (refined.has(i) === refined.has(i + 1)) continue;
    const [r, u] = refined.has(i) ? [i, i + 1] : [i + 1, i];
    const mBefore = merged[i];
    const mAfter = merged[i + 1];
    const fBefore = firstPass[i];
    const fAfter = firstPass[i + 1];
    const stuck = merged[u];
    if (!mBefore || !mAfter || !fBefore || !fAfter || !stuck || stuck.terminal || stuck.source === 'terminal') continue;
    const mover = moverOf(fens[i]);
    const mergedLoss = expectedPointsLoss(mBefore.score, mAfter.score, mover);
    const firstLoss = expectedPointsLoss(fBefore.score, fAfter.score, mover);
    if (mergedLoss >= LOSS_INACCURACY && mergedLoss > firstLoss + BOUNDARY_MARGIN) out.push({ refined: r, unrefined: u, loss: mergedLoss });
  }
  return out.sort((a, b) => b.loss - a.loss || a.unrefined - b.unrefined);
}

/** Positions to search next: the unrefined side of every harmful boundary move, worst first, without repeats. */
export function harmfulBoundaries(
  fens: readonly string[],
  firstPass: readonly (PositionEval | undefined)[],
  merged: readonly (PositionEval | undefined)[],
  refined: ReadonlySet<number>,
): number[] {
  return [...new Set(harmfulBoundaryMoves(fens, firstPass, merged, refined).map((b) => b.unrefined))];
}

/** Indexes whose evaluation in `merged` is not the first-pass object, i.e. that were searched again. */
export function refinedPositions(firstPass: readonly (PositionEval | undefined)[], merged: readonly (PositionEval | undefined)[]): Set<number> {
  const out = new Set<number>();
  merged.forEach((e, i) => {
    if (e && e !== firstPass[i]) out.add(i);
  });
  return out;
}
