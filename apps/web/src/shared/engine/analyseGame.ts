import { Chess } from 'chess.js';
import { terminalEval, type PositionEval } from '@knightfall/core';
import type { CloudEvalClient } from './cloudEval.ts';
import { harmfulBoundaries, harmfulBoundaryMoves, MAX_EXTRA_POSITIONS, MAX_EXTRA_ROUNDS, positionsToRefine, refinedPositions } from './keyMoments.ts';
import { AbortError, type EvalJob } from './pool.ts';

/**
 * Evaluate every position of a game. Order of preference per position:
 *   1. finished positions (mate, stalemate, bare kings) are scored without any engine;
 *   2. the Lichess cloud (WintrChess rule): walk the positions from the first, in order, asking for MultiPV 2;
 *      accept an answer only if its depth >= the review depth and it has enough lines (min(multiPv, legal moves));
 *      at the first miss, rejection or timeout the cloud is not asked again for this game;
 *   3. every remaining position goes to the local engine pool (each from a clean hash).
 * Results stream out through onEval as they arrive, in no fixed order.
 */

export interface AnalysePositionsOptions {
  /** Every position of the game: moves + 1 FENs. */
  fens: readonly string[];
  depth: number;
  /** Default 2 (REVIEW_MULTIPV). */
  multiPv?: number;
  /** EnginePool.evaluate (or a fake in tests). */
  evaluate: (job: EvalJob) => Promise<PositionEval>;
  /** Omit to skip the cloud. */
  cloud?: CloudEvalClient;
  signal?: AbortSignal;
  /** Evaluations already known (e.g. from an interrupted run); those positions are not analysed again. */
  known?: readonly (PositionEval | undefined)[];
  /** Called once per position as soon as its evaluation exists. `done` counts finished positions. */
  onEval?: (index: number, evaluation: PositionEval, done: number, total: number) => void;
}

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 0;
  }
}

/** Resolves with one evaluation per FEN. Rejects with AbortError when aborted, or the first engine error. */
export async function analysePositions(opts: AnalysePositionsOptions): Promise<PositionEval[]> {
  const { fens, depth, evaluate, cloud, signal, known, onEval } = opts;
  const multiPv = opts.multiPv ?? 2;
  const total = fens.length;
  const out: (PositionEval | undefined)[] = new Array(total).fill(undefined);
  let done = 0;
  const finish = (i: number, e: PositionEval) => {
    if (out[i]) return;
    out[i] = e;
    done++;
    onEval?.(i, e, done, total);
  };
  if (signal?.aborted) throw new AbortError();

  const pending: number[] = [];
  fens.forEach((fen, i) => {
    const have = known?.[i] ?? terminalEval(fen);
    if (have) finish(i, have);
    else pending.push(i);
  });

  // Earlier plies first, so the graph fills from the left. `fresh`: every position starts from a clean hash.
  const runLocal = (i: number): Promise<void> => {
    const p = evaluate({ fen: fens[i], depth, multiPv, priority: -i, signal, fresh: true }).then((e) => finish(i, e));
    p.catch(() => {}); // the real handler is the Promise.all below; this only prevents an unhandled-rejection report
    return p;
  };

  const jobs: Promise<void>[] = [];
  const cloudJob = (async () => {
    let k = 0;
    if (cloud) {
      for (; k < pending.length; k++) {
        if (signal?.aborted) throw new AbortError();
        const i = pending[k];
        const hit = await cloud.get(fens[i], multiPv, Math.min(multiPv, legalMoveCount(fens[i])), signal);
        if (!hit || hit.depth < depth) break; // first miss: the cloud is done for this game
        finish(i, hit);
      }
    }
    for (; k < pending.length; k++) jobs.push(runLocal(pending[k]));
  })();

  // Wait for the cloud pass first: it is what adds the late local jobs to `jobs`.
  try {
    await cloudJob;
    await Promise.all(jobs);
  } catch (e) {
    cloudJob.catch(() => {});
    throw e;
  }
  if (signal?.aborted) throw new AbortError();
  return out as PositionEval[];
}

export interface RefineOptions {
  fens: readonly string[];
  /** First-pass evaluations, one per FEN. */
  evals: readonly PositionEval[];
  /** Positions to look at again (see criticalPlies). */
  plies: readonly number[];
  /** Depth of the second pass. Positions already at least this deep are left alone. */
  depth: number;
  multiPv?: number;
  evaluate: (job: EvalJob) => Promise<PositionEval>;
  signal?: AbortSignal;
  /** Called once per re-searched position with the evaluation that is kept. `done` counts finished positions. */
  onEval?: (index: number, evaluation: PositionEval, done: number, total: number) => void;
}

/**
 * Second pass of a review: search the chosen positions again, deeper, and keep a new evaluation only when it
 * is deeper than the one already there. Uses the same pool (so never more engines than the pool allows),
 * every search from a clean hash. Returns a copy of `evals`. Rejects with AbortError when aborted.
 */
export async function refineKeyMoments(opts: RefineOptions): Promise<PositionEval[]> {
  const { fens, evals, depth, evaluate, signal, onEval } = opts;
  const multiPv = opts.multiPv ?? 2;
  const out = evals.slice();
  const targets = positionsToRefine(evals, opts.plies, depth);
  if (signal?.aborted) throw new AbortError();
  if (!targets.length) return out;

  // One controller for the whole pass: the first failure stops the searches that are still queued or running.
  const inner = new AbortController();
  const forward = () => inner.abort();
  signal?.addEventListener('abort', forward, { once: true });
  let done = 0;
  try {
    await Promise.all(
      targets.map((i, rank) => {
        const p = evaluate({ fen: fens[i], depth, multiPv, priority: targets.length - rank, signal: inner.signal, fresh: true }).then((e) => {
          if (e.depth > out[i].depth) out[i] = e;
          done++;
          onEval?.(i, out[i], done, targets.length);
        });
        p.catch(() => inner.abort());
        return p;
      }),
    );
  } finally {
    signal?.removeEventListener('abort', forward);
  }
  if (signal?.aborted) throw new AbortError();
  return out;
}

export interface ConsistentRefineOptions extends RefineOptions {
  /** Most extra positions the consistency rounds may add. Default MAX_EXTRA_POSITIONS (see extraPositionCap). */
  maxExtra?: number;
}

/**
 * refineKeyMoments, then make sure no move is judged from a deep evaluation on one side and a shallow one on
 * the other. A move compares the position before it with the one after it; when only one of them was
 * searched deeper, the depth difference alone can turn a fine move into a "miss". Up to MAX_EXTRA_ROUNDS
 * times, the shallow side of every such move that got worse (see harmfulBoundaries) is searched deeper too
 * (at most `maxExtra` positions in all; the progress total grows with them). A move still inconsistent after
 * that gets the first-pass evaluation back on its deep side, so it is judged at one depth. That is the only
 * case where a position's evaluation gets shallower; the revert repeats until no such move is left.
 */
export async function refineConsistently(opts: ConsistentRefineOptions): Promise<PositionEval[]> {
  const { fens, evals: first, depth, signal, onEval } = opts;
  const maxExtra = opts.maxExtra ?? MAX_EXTRA_POSITIONS;
  let total = positionsToRefine(first, opts.plies, depth).length;
  let out = await refineKeyMoments(opts);
  let extra = 0;
  for (let round = 0; round < MAX_EXTRA_ROUNDS; round++) {
    const next = harmfulBoundaries(fens, first, out, refinedPositions(first, out))
      .filter((i) => positionsToRefine(out, [i], depth).length > 0)
      .slice(0, maxExtra - extra);
    if (!next.length) break;
    const base = total;
    total += next.length;
    extra += next.length;
    out = await refineKeyMoments({ ...opts, evals: out, plies: next, onEval: onEval && ((i, e, done) => onEval(i, e, base + done, total)) });
  }
  if (signal?.aborted) throw new AbortError();
  out = out.slice();
  for (;;) {
    const bad = harmfulBoundaryMoves(fens, first, out, refinedPositions(first, out));
    if (!bad.length) break;
    for (const b of bad) out[b.refined] = first[b.refined];
  }
  return out;
}
