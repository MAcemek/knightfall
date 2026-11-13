import { Chess } from 'chess.js';
import { terminalEval, type PositionEval } from '@knightfall/core';
import type { CloudEvalClient } from './cloudEval.ts';
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
