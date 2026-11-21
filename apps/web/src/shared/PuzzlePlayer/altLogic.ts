import { Chess } from 'chess.js';
import { judgeMove, uciToMove, type MoveVerdict, type Puzzle } from '@knightfall/core';

/** Puzzle.alts support: a solver move listed as an equally good alternative counts as correct. */

/** judgeMove plus 'alt': the move differs from the solution but is listed in `puzzle.alts[ply]`. */
export function judgePuzzleMove(puzzle: Puzzle, ply: number, fenBefore: string, uci: string): MoveVerdict | 'alt' {
  const expected = puzzle.moves[ply];
  const verdict = judgeMove(fenBefore, expected, uci);
  if (verdict === 'wrong' && puzzle.alts?.[ply]?.includes(uci)) return 'alt';
  return verdict;
}

/** Message shown when an alternative was played; the runner then plays `expected` for the solver. */
export function altNotice(fenBefore: string, expected: string): string {
  const san = new Chess(fenBefore).move(uciToMove(expected)).san;
  return `Also good. The engine's line continues with ${san}`;
}
