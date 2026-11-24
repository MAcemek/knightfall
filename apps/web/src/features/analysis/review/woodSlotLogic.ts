import { GAME_PUZZLE_PREFIX, PRACTICE_CLASSES, type AnalysedMove } from '@knightfall/core';

/** "Add to next Woodpecker set" under the move list: which of its three looks the shown move gets (pure, no React). */

export type WoodSlotState = { kind: 'hidden' } | { kind: 'add'; puzzleId: string } | { kind: 'in-set' };

/** Id of the practice puzzle made from a move of a game (same format as mistakePuzzles in core). */
export function gamePuzzleId(gameKey: string, ply: number): string {
  return `${GAME_PUZZLE_PREFIX}${gameKey}-${ply}`;
}

/**
 * Only the player's own mistakes, misses and blunders can be picked, and only when a puzzle was made from the move.
 * `puzzleIds` are the ids of practicePuzzles(game, report, side); `picks` are the ids already in the next set.
 */
export function woodSlotState(p: {
  gameKey: string;
  move: Pick<AnalysedMove, 'ply' | 'color' | 'class'> | null;
  classified: boolean;
  side: 'w' | 'b' | null;
  puzzleIds: ReadonlySet<string>;
  picks: readonly string[];
}): WoodSlotState {
  const { move } = p;
  if (!move || !p.classified || !p.side || move.color !== p.side || !PRACTICE_CLASSES.has(move.class)) return { kind: 'hidden' };
  const id = gamePuzzleId(p.gameKey, move.ply);
  if (!p.puzzleIds.has(id)) return { kind: 'hidden' };
  return p.picks.includes(id) ? { kind: 'in-set' } : { kind: 'add', puzzleId: id };
}
