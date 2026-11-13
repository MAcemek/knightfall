import { Chess } from 'chess.js';
import { scoreToCp, terminalEval, uciToMove, type PositionEval } from '@knightfall/core';
import type { EvalJob } from '../../shared/engine/index.ts';
import { isSolverPly } from './logic.ts';

/**
 * "Check with engine" for the custom puzzle editor: is every solver move the clearly best move?
 * A puzzle is sound when the solver's move beats every alternative by a real margin; if a second move
 * is (almost) as good, solvers who find it are told they are wrong.
 */

/** A second move within this many centipawns of the best one makes the puzzle ambiguous. */
export const AMBIGUITY_GAP_CP = 150;
export const ENGINE_CHECK_DEPTH = 14;

export type MoveVerdict =
  /** The solver move is the engine's first choice and clearly better than the rest. */
  | 'unique'
  /** The solver move is fine, but `other` is about as good: the puzzle has two solutions. */
  | 'alternative'
  /** The engine prefers `other` by a clear margin: the recorded move is not the best move. */
  | 'weaker'
  /** The move ends the game (mate) or was the only legal move: nothing to check. */
  | 'trivial';

export interface MoveCheck {
  /** Index into the solution line. */
  ply: number;
  san: string;
  verdict: MoveVerdict;
  /** The competing move (SAN), for 'alternative' and 'weaker'. */
  other?: string;
  /** How much better the best line is than the next one, in centipawns from the mover's side (capped at 2000). */
  gapCp?: number;
}

function sanOf(fen: string, uci: string): string {
  try {
    return new Chess(fen).move(uciToMove(uci)).san;
  } catch {
    return uci;
  }
}

/** Judge one solver move from a MultiPV >= 2 evaluation of the position before it. Pure. */
export function judgeSolverMove(before: PositionEval, uci: string, ply: number): MoveCheck {
  const fen = before.fen;
  const san = sanOf(fen, uci);
  const mover = fen.split(' ')[1] === 'b' ? -1 : 1;
  const [top, second] = before.lines;
  if (!top || !second) return { ply, san, verdict: 'trivial' };
  const gapCp = mover * (scoreToCp(top.score) - scoreToCp(second.score)) + ('mate' in top.score && !('mate' in second.score) ? 1000 : 0);
  if (top.pv[0] === uci) {
    return gapCp < AMBIGUITY_GAP_CP ? { ply, san, verdict: 'alternative', other: sanOf(fen, second.pv[0]), gapCp } : { ply, san, verdict: 'unique', gapCp };
  }
  if (second.pv[0] === uci && gapCp < AMBIGUITY_GAP_CP) return { ply, san, verdict: 'alternative', other: sanOf(fen, top.pv[0]), gapCp };
  return { ply, san, verdict: 'weaker', other: sanOf(fen, top.pv[0]), gapCp };
}

export interface CheckOptions {
  fen: string;
  moves: readonly string[];
  opponentFirst: boolean;
  /** EnginePool.evaluate. */
  evaluate: (job: EvalJob) => Promise<PositionEval>;
  signal?: AbortSignal;
  /** Called after each solver move has been judged. */
  onResult?: (check: MoveCheck, done: number, total: number) => void;
}

/**
 * Check every solver move of a recorded line, in order. Resolves with one MoveCheck per solver move.
 * Rejects with AbortError when aborted, or with the engine's error.
 */
export async function checkSolution(opts: CheckOptions): Promise<MoveCheck[]> {
  const { fen, moves, opponentFirst, evaluate, signal, onResult } = opts;
  const chess = new Chess(fen);
  const jobs: { ply: number; fen: string; uci: string; legal: number }[] = [];
  moves.forEach((uci, ply) => {
    if (isSolverPly(ply, opponentFirst)) jobs.push({ ply, fen: chess.fen(), uci, legal: chess.moves().length });
    chess.move(uciToMove(uci));
  });
  const out: MoveCheck[] = [];
  for (const job of jobs) {
    let check: MoveCheck;
    const after = terminalEval(new Chess(job.fen).move(uciToMove(job.uci)).after);
    if (job.legal <= 1 || after?.terminal === 'checkmate') {
      check = { ply: job.ply, san: sanOf(job.fen, job.uci), verdict: 'trivial' };
    } else {
      const before = await evaluate({ fen: job.fen, depth: ENGINE_CHECK_DEPTH, multiPv: 2, priority: 100 - job.ply, signal });
      check = judgeSolverMove(before, job.uci, job.ply);
    }
    out.push(check);
    onResult?.(check, out.length, jobs.length);
  }
  return out;
}

/** One line for the result panel. */
export function summarise(checks: readonly MoveCheck[]): { tone: 'good' | 'warn' | 'bad'; text: string } {
  const weaker = checks.filter((c) => c.verdict === 'weaker').length;
  const alt = checks.filter((c) => c.verdict === 'alternative').length;
  if (weaker) return { tone: 'bad', text: `${weaker} solver move${weaker === 1 ? ' is' : 's are'} not the engine's best move.` };
  if (alt) return { tone: 'warn', text: `${alt} solver move${alt === 1 ? ' has' : 's have'} a second solution that is about as good.` };
  return { tone: 'good', text: 'Every solver move is the clear best move.' };
}
