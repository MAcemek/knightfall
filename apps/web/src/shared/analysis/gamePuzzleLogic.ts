import { GAME_PUZZLE_PREFIX, mistakePuzzles, type GameReport } from '@knightfall/core';
import type { StoredGame } from '../db.ts';
import { resolveSide, type KnownUsers } from './side.ts';

/** Pure rules for puzzles made from the player's own games (ids "game-<gameKey>-<ply>"). */

export function isGamePuzzleId(id: string): boolean {
  return id.startsWith(GAME_PUZZLE_PREFIX);
}

/** True for exactly "game-<gameKey>-<ply>" (another key that merely starts with this one does not match). */
export function isPuzzleOfGame(id: string, gameKey: string): boolean {
  const prefix = `${GAME_PUZZLE_PREFIX}${gameKey}-`;
  return id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length));
}

/**
 * Order for a "From my games" session: puzzles due now first (most overdue first); with `all` the rest follow
 * in the given order. `reviews` is the spaced-repetition queue (rows of other puzzles are ignored).
 */
export function orderGamePuzzles(ids: readonly string[], reviews: readonly { puzzleId: string; due: number }[], now: number, mode: 'due' | 'all'): string[] {
  const own = new Set(ids);
  const due = reviews.filter((r) => own.has(r.puzzleId) && r.due <= now).sort((a, b) => a.due - b.due).map((r) => r.puzzleId);
  if (mode === 'due') return due;
  const dueSet = new Set(due);
  return [...due, ...ids.filter((id) => !dueSet.has(id))];
}

export interface BulkAddRow {
  game: StoredGame;
  report: GameReport;
}

export interface BulkAddItem extends BulkAddRow {
  side: 'w' | 'b';
  /** Puzzles of this game that are not stored yet. */
  fresh: number;
}

/**
 * Bulk add over every analysed game: only games whose side is known and that still yield puzzles not in
 * `existingIds`. `newCount` is the total number of puzzles that would be added.
 */
export function planBulkAdd(rows: readonly BulkAddRow[], users: KnownUsers, existingIds: ReadonlySet<string>): { items: BulkAddItem[]; newCount: number } {
  const items: BulkAddItem[] = [];
  let newCount = 0;
  for (const { game, report } of rows) {
    const side = resolveSide(game, users);
    if (!side) continue;
    const me = side === 'w' ? game.white : game.black;
    const opponent = side === 'w' ? game.black : game.white;
    const puzzles = mistakePuzzles(report, { gameKey: game.key, side, rating: me.rating ?? 1500, label: `vs ${opponent.name}` });
    const fresh = puzzles.filter((p) => !existingIds.has(p.id)).length;
    if (!fresh) continue;
    items.push({ game, report, side, fresh });
    newCount += fresh;
  }
  return { items, newCount };
}
