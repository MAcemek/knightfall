import { Chess } from 'chess.js';
import { uciToMove, type PositionEval } from '@knightfall/core';

export interface WrongExplanation {
  /** The wrong move in standard notation, e.g. "Nf3". */
  moveSan: string;
  /** The position after the wrong move (what the engine was asked about). */
  fenAfter: string;
  /** The opponent's best answer, when there is one. */
  reply?: { uci: string; san: string };
  text: string;
}

/** Below this the position counts as level, from the side that played the wrong move. */
const LEVEL_CP = 60;
/** From this the better side is clearly winning. */
const WINNING_CP = 200;

function pawns(whiteCp: number): string {
  const v = (Math.abs(whiteCp) / 100).toFixed(1);
  if (whiteCp === 0) return '0.0';
  return `${whiteCp > 0 ? '+' : '−'}${v}`;
}

/**
 * Plain-English reason a move was wrong. `evalAfter` is the engine's evaluation of the position AFTER the
 * wrong move (scores are White-POV, lines are for the side to move there, i.e. the opponent).
 * The text is phrased from the solver's side: the solver is the one who played `wrongUci`.
 * Throws when `wrongUci` is not legal in `fenBefore`.
 */
export function explainWrong(fenBefore: string, wrongUci: string, evalAfter: PositionEval): WrongExplanation {
  const board = new Chess(fenBefore);
  const mover = board.turn();
  const moverName = mover === 'w' ? 'White' : 'Black';
  const oppName = mover === 'w' ? 'Black' : 'White';
  const m = board.move(uciToMove(wrongUci));
  const fenAfter = board.fen();
  const moveSan = m.san;
  const base = { moveSan, fenAfter };

  if (evalAfter.terminal === 'stalemate') return { ...base, text: `${moveSan} allows stalemate.` };
  if (evalAfter.terminal === 'draw') return { ...base, text: `${moveSan} leads to a draw.` };
  if (evalAfter.terminal === 'checkmate') return { ...base, text: `${moveSan} is checkmate.` };

  const best = evalAfter.lines[0];
  const replyUci = best?.pv[0];
  let reply: { uci: string; san: string } | undefined;
  if (replyUci) {
    try {
      reply = { uci: replyUci, san: new Chess(fenAfter).move(uciToMove(replyUci)).san };
    } catch {
      reply = undefined;
    }
  }

  const score = evalAfter.score;
  const label = 'mate' in score ? null : pawns(score.cp);
  // Positive = good for the side that played the wrong move.
  const moverSigned = 'mate' in score ? (mover === 'w' ? score.mate : -score.mate) : mover === 'w' ? score.cp : -score.cp;

  if ('mate' in score && moverSigned < 0) {
    const n = Math.abs(score.mate);
    return { ...base, reply, text: reply ? `After ${moveSan}, ${oppName} answers ${reply.san} and mates in ${n}.` : `After ${moveSan}, ${oppName} mates in ${n}.` };
  }
  if ('mate' in score) {
    return { ...base, reply, text: `After ${moveSan}, ${moverName} still mates in ${Math.abs(score.mate)}, but the puzzle's move is better.` };
  }
  if (!reply) {
    return { ...base, text: moverSigned >= LEVEL_CP ? `After ${moveSan}, ${moverName} is still better (${label}), but the puzzle's move wins more.` : `After ${moveSan}, the position is about level (${label}).` };
  }
  const opp = -moverSigned;
  if (opp >= WINNING_CP) return { ...base, reply, text: `After ${moveSan}, ${oppName} answers ${reply.san} and is winning (${label}).` };
  if (opp >= LEVEL_CP) return { ...base, reply, text: `After ${moveSan}, ${oppName} answers ${reply.san} and is better (${label}).` };
  if (moverSigned >= LEVEL_CP) return { ...base, reply, text: `After ${moveSan}, ${moverName} is still better (${label}), but the puzzle's move wins more.` };
  return { ...base, reply, text: `After ${moveSan}, ${oppName} answers ${reply.san} and the position is about level (${label}), but the puzzle's move wins more.` };
}

/** The position after `uci` is played from `fenBefore`; throws when the move is illegal. */
export function fenAfterMove(fenBefore: string, uci: string): string {
  const board = new Chess(fenBefore);
  board.move(uciToMove(uci));
  return board.fen();
}
