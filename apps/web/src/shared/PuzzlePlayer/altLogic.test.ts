import { describe, expect, it } from 'vitest';
import type { Puzzle } from '@knightfall/core';
import { altNotice, judgePuzzleMove } from './altLogic.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const base: Puzzle = { id: 'game-x-0', fen: START, moves: ['e2e4', 'e7e5'], opponentFirst: false, rating: 1500, themes: [], source: 'custom' };

describe('judgePuzzleMove', () => {
  it('behaves like judgeMove when the puzzle has no alts', () => {
    expect(judgePuzzleMove(base, 0, START, 'e2e4')).toBe('correct');
    expect(judgePuzzleMove(base, 0, START, 'd2d4')).toBe('wrong');
  });
  it('accepts a listed alternative at that move index only', () => {
    const p = { ...base, alts: { 0: ['d2d4'] } };
    expect(judgePuzzleMove(p, 0, START, 'd2d4')).toBe('alt');
    expect(judgePuzzleMove(p, 0, START, 'c2c4')).toBe('wrong');
    expect(judgePuzzleMove(p, 0, START, 'e2e4')).toBe('correct');
    expect(judgePuzzleMove({ ...p, alts: { 2: ['d2d4'] } }, 0, START, 'd2d4')).toBe('wrong');
  });
});

describe('altNotice', () => {
  it('names the engine move in SAN', () => {
    expect(altNotice(START, 'e2e4')).toBe("Also good. The engine's line continues with e4");
  });
});
