import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { uciToMove } from '../validate.ts';

/** Material detection for the "brilliant" class. Pure chess.js, no engine. */

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Non-pawn, non-king material of both sides together (used for the endgame boundary). */
export function pieceMaterial(fen: string): number {
  let total = 0;
  for (const ch of fen.split(' ')[0]) {
    const v = PIECE_VALUE[ch.toLowerCase() as PieceSymbol];
    if (v && ch.toLowerCase() !== 'p') total += v;
  }
  return total;
}

/**
 * True when `uci` offers material: after the move the moved piece (not a pawn or king) can be captured
 * and the mover comes out at least two points behind on that square, counting what the move itself
 * captured and, if the square is defended, the cheapest capturing piece as won back.
 * Examples: a knight left en prise to a pawn (3 - 0 - 1 = 2), a queen taking a defended pawn (9 - 1 - x).
 * An equal trade or winning a piece is never a sacrifice. Illegal input returns false.
 */
export function isSacrifice(fenBefore: string, uci: string): boolean {
  let chess: Chess;
  let move;
  try {
    chess = new Chess(fenBefore);
    move = chess.move(uciToMove(uci));
  } catch {
    return false;
  }
  const piece = move.promotion ?? move.piece;
  if (piece === 'p' || piece === 'k') return false;
  if (chess.isGameOver()) return false;
  const given = PIECE_VALUE[piece] - (move.captured ? PIECE_VALUE[move.captured] : 0);
  if (given < 2) return false;
  // Legal captures of the moved piece (pins respected because these are legal moves).
  const takers = chess.moves({ verbose: true }).filter((m) => m.to === move.to && m.isCapture());
  if (!takers.length) return false;
  const cheapest = Math.min(...takers.map((m) => PIECE_VALUE[m.piece]));
  const defended = chess.isAttacked(move.to as Square, move.color);
  // A king cannot recapture into an attack, but legal-move generation already excluded that.
  return given - (defended ? cheapest : 0) >= 2;
}
