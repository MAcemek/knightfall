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
 * A position that occurs more than once (same board, side to move, castling and en passant; the move counters may differ)
 * is searched once and the result is copied to every occurrence.
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

const positionKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

/**
 * Which positions need a search. `ready` are already scored (known or finished); `searches` holds one index per
 * distinct remaining position (the first occurrence); `copies` maps a searched index to the later indices of the same
 * position (repetition shuffles), which take its result. A position already scored elsewhere is copied from there.
 * Positions are compared without the halfmove clock and move number, which differ between repetitions.
 */
export function planPositions(fens: readonly string[], known?: readonly (PositionEval | undefined)[]): { ready: [number, PositionEval][]; searches: number[]; copies: Map<number, number[]> } {
  const ready: [number, PositionEval][] = [];
  const scored = new Map<string, PositionEval>();
  const rest: number[] = [];
  fens.forEach((fen, i) => {
    const have = known?.[i] ?? terminalEval(fen);
    if (have) {
      ready.push([i, have]);
      scored.set(positionKey(fen), have);
    } else rest.push(i);
  });
  const searches: number[] = [];
  const first = new Map<string, number>();
  const copies = new Map<number, number[]>();
  for (const i of rest) {
    const key = positionKey(fens[i]);
    const have = scored.get(key);
    if (have) {
      ready.push([i, { ...have, fen: fens[i] }]);
      continue;
    }
    const head = first.get(key);
    if (head === undefined) {
      first.set(key, i);
      searches.push(i);
    } else copies.set(head, [...(copies.get(head) ?? []), i]);
  }
  return { ready, searches, copies };
}

/** Resolves with one evaluation per FEN. Rejects with AbortError when aborted, or the first engine error. */
export async function analysePositions(opts: AnalysePositionsOptions): Promise<PositionEval[]> {
  const { fens, depth, evaluate, cloud, known, onEval } = opts;
  const multiPv = opts.multiPv ?? 2;
  const total = fens.length;
  const out: (PositionEval | undefined)[] = new Array(total).fill(undefined);
  let done = 0;
  // Internal controller: chained to the caller's signal, and aborted on the first failure so nothing else keeps running.
  const ctl = new AbortController();
  const signal = ctl.signal;
  const onOuterAbort = () => ctl.abort();
  if (opts.signal?.aborted) ctl.abort();
  else opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const finish = (i: number, e: PositionEval) => {
    if (out[i] || signal.aborted) return;
    out[i] = e;
    done++;
    onEval?.(i, e, done, total);
  };
  if (signal.aborted) throw new AbortError();

  const plan = planPositions(fens, known);
  const pending = plan.searches;
  plan.ready.forEach(([i, e]) => finish(i, e));
  // A searched position also fills every later position with the same FEN.
  const finishWithCopies = (i: number, e: PositionEval) => {
    finish(i, e);
    plan.copies.get(i)?.forEach((j) => finish(j, { ...e, fen: fens[j] }));
  };

  // Earlier plies first, so the graph fills from the left. `fresh`: every position starts from a clean hash.
  const runLocal = (i: number): Promise<void> => {
    const p = evaluate({ fen: fens[i], depth, multiPv, priority: -i, signal, fresh: true }).then((e) => finishWithCopies(i, e));
    p.catch(() => {}); // the real handler is the Promise.all below; this only prevents an unhandled-rejection report
    return p;
  };

  const jobs: Promise<void>[] = [];
  const cloudJob = (async () => {
    let k = 0;
    if (cloud) {
      for (; k < pending.length; k++) {
        if (signal.aborted) throw new AbortError();
        const i = pending[k];
        const hit = await cloud.get(fens[i], multiPv, Math.min(multiPv, legalMoveCount(fens[i])), signal);
        if (!hit || hit.depth < depth) break; // first miss: the cloud is done for this game
        finishWithCopies(i, hit);
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
    ctl.abort();
    throw e;
  } finally {
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
  if (signal.aborted) throw new AbortError();
  return out as PositionEval[];
}
