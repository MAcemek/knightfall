import { Chess } from 'chess.js';

export type MoveVerdict = 'correct' | 'mate' | 'wrong';

export function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}

export function moveToUci(m: { from: string; to: string; promotion?: string }): string {
  return m.from + m.to + (m.promotion ?? '');
}

/**
 * Judge a solver move.
 *  - 'correct': matches the expected solution move.
 *  - 'mate':    differs from the solution but delivers checkmate (accepted; puzzle is solved).
 *  - 'wrong':   anything else (including illegal moves).
 */
export function judgeMove(fenBefore: string, expectedUci: string, playedUci: string): MoveVerdict {
  if (playedUci === expectedUci) return 'correct';
  const chess = new Chess(fenBefore);
  try {
    chess.move(uciToMove(playedUci));
  } catch {
    return 'wrong';
  }
  return chess.isCheckmate() ? 'mate' : 'wrong';
}

/** Validate that a full line is legal from a FEN. Returns an error message, or null when valid. */
export function validateLine(fen: string, moves: string[]): string | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch (e) {
    return `Invalid FEN: ${(e as Error).message}`;
  }
  for (let i = 0; i < moves.length; i++) {
    try {
      chess.move(uciToMove(moves[i]));
    } catch {
      return `Illegal move #${i + 1}: ${moves[i]}`;
    }
  }
  return null;
}
