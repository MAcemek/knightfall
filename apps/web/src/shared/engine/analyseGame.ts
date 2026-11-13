import { Chess } from 'chess.js';
import { terminalEval, type PositionEval } from '@knightfall/core';
import { CLOUD_MAX_PLY, type CloudEvalClient } from './cloudEval.ts';
import { AbortError, type EvalJob } from './pool.ts';

/**
 * Evaluate every position of a game. Order of preference per position:
 *   1. finished positions (mate, stalemate, bare kings) are scored without any engine;
 *   2. the first CLOUD_MAX_PLY positions try the Lichess cloud (serial, short timeout);
 *   3. everything else goes to the local engine pool.
 * Results stream out through onEval as they arrive, in no fixed order.
 */

export interface AnalysePositionsOptions {
  /** Every position of the game: moves + 1 FENs. */
  fens: readonly string[];
  depth: number;
  /** Default 3. */
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

/** After this many cloud misses in a row the cloud is not asked again for this game. */
const CLOUD_GIVE_UP_AFTER = 2;

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
  const multiPv = opts.multiPv ?? 3;
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

  const local: number[] = [];
  const cloudFirst: number[] = [];
  fens.forEach((fen, i) => {
    const have = known?.[i] ?? terminalEval(fen);
    if (have) finish(i, have);
    else if (cloud && i < CLOUD_MAX_PLY) cloudFirst.push(i);
    else local.push(i);
  });

  // Earlier plies first, so the graph fills from the left. Cloud misses jump the queue.
  const runLocal = (i: number, boost = 0): Promise<void> => {
    const p = evaluate({ fen: fens[i], depth, multiPv, priority: boost - i, signal }).then((e) => finish(i, e));
    p.catch(() => {}); // the real handler is the Promise.all below; this only prevents an unhandled-rejection report
    return p;
  };

  const jobs: Promise<void>[] = local.map((i) => runLocal(i));
  const cloudJob = (async () => {
    let misses = 0;
    for (const i of cloudFirst) {
      if (signal?.aborted) throw new AbortError();
      const hit = misses >= CLOUD_GIVE_UP_AFTER || !cloud ? null : await cloud.get(fens[i], multiPv, Math.min(multiPv, legalMoveCount(fens[i])), signal);
      if (hit) {
        misses = 0;
        finish(i, hit);
      } else {
        misses++;
        jobs.push(runLocal(i, 10_000));
      }
    }
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
