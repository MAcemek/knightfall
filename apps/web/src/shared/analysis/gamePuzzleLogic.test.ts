import { describe, expect, it } from 'vitest';
import type { GameReport } from '@knightfall/core';
import type { StoredGame } from '../db.ts';
import { isGamePuzzleId, isPuzzleOfGame, orderGamePuzzles, planBulkAdd } from './gamePuzzleLogic.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** One white blunder at ply 0 whose engine line starts with e2e4. */
const report = {
  moves: [{ ply: 0, color: 'w', class: 'blunder', uci: 'a2a3', fenBefore: START, moveNumber: 1 }],
  evals: [{ fen: START, depth: 16, source: 'engine', score: { cp: 30 }, lines: [{ score: { cp: 30 }, pv: ['e2e4'] }] }],
} as unknown as GameReport;

const game = (key: string, extra: Partial<StoredGame> = {}): StoredGame =>
  ({ key, source: 'lichess', white: { name: 'Me' }, black: { name: 'Them' }, importedFor: 'me', ...extra }) as StoredGame;
const NO_USERS = { lichessUser: '', chesscomUser: '' };

describe('game puzzle ids', () => {
  it('recognises game ids and matches a game exactly', () => {
    expect(isGamePuzzleId('game-li-abc-5')).toBe(true);
    expect(isGamePuzzleId('custom-1')).toBe(false);
    expect(isPuzzleOfGame('game-li-abc-5', 'li-abc')).toBe(true);
    expect(isPuzzleOfGame('game-li-abc-2-5', 'li-abc')).toBe(false);
    expect(isPuzzleOfGame('game-li-abc-2-5', 'li-abc-2')).toBe(true);
    expect(isPuzzleOfGame('other', 'li-abc')).toBe(false);
  });
});

describe('orderGamePuzzles', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const reviews = [
    { puzzleId: 'c', due: 50 },
    { puzzleId: 'b', due: 10 },
    { puzzleId: 'd', due: 500 },
    { puzzleId: 'zzz', due: 1 },
  ];
  it('serves due puzzles first, most overdue first', () => {
    expect(orderGamePuzzles(ids, reviews, 100, 'due')).toEqual(['b', 'c']);
  });
  it('in all mode the rest follow in the given order', () => {
    expect(orderGamePuzzles(ids, reviews, 100, 'all')).toEqual(['b', 'c', 'a', 'd']);
  });
  it('is empty when nothing is due in due mode', () => {
    expect(orderGamePuzzles(ids, [], 100, 'due')).toEqual([]);
  });
});

describe('planBulkAdd', () => {
  it('adds games whose side is known and counts new puzzles', () => {
    const plan = planBulkAdd([{ game: game('li-1'), report }], NO_USERS, new Set());
    expect(plan.newCount).toBe(1);
    expect(plan.items[0]).toMatchObject({ side: 'w', fresh: 1 });
  });
  it('skips games with an unknown side, and puzzles that already exist', () => {
    const unknown = game('pgn-1', { source: 'pgn', importedFor: undefined });
    expect(planBulkAdd([{ game: unknown, report }], NO_USERS, new Set()).items).toEqual([]);
    expect(planBulkAdd([{ game: game('li-1'), report }], NO_USERS, new Set(['game-li-1-0']))).toEqual({ items: [], newCount: 0 });
  });
  it('uses the remembered username when the game was not imported for one', () => {
    const g = game('li-2', { importedFor: undefined });
    expect(planBulkAdd([{ game: g, report }], NO_USERS, new Set()).items).toEqual([]);
    expect(planBulkAdd([{ game: g, report }], { lichessUser: 'ME', chesscomUser: '' }, new Set()).newCount).toBe(1);
  });
});
