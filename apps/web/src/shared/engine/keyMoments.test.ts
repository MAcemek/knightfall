import { describe, expect, it } from 'vitest';
import type { PositionEval } from '@knightfall/core';
import { criticalPlies, keyPositionCap, MAX_KEY_POSITIONS, MOBILE_MAX_KEY_POSITIONS, positionsToRefine } from './keyMoments.ts';

const BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
/** White moves at even indexes, Black at odd ones. */
const fenAt = (i: number) => `${BOARD} ${i % 2 ? 'b' : 'w'} KQkq - 0 ${i}`;
const ev = (i: number, cp: number, depth = 18): PositionEval => ({ fen: fenAt(i), depth, source: 'engine', lines: [{ score: { cp }, pv: ['e2e4'] }], score: { cp } });
/** A game whose scores (White view) are `cps`. */
const game = (cps: number[], depth = 18) => ({ fens: cps.map((_, i) => fenAt(i)), evals: cps.map((cp, i) => ev(i, cp, depth)) });
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

describe('criticalPlies', () => {
  it('returns nothing for a quiet game', () => {
    const { fens, evals } = game([20, 20, 20, 20, 20, 20]);
    expect(criticalPlies(fens, evals, { swings: 0 })).toEqual([]);
  });

  it('takes the position before and after a costly move, and no others', () => {
    const { fens, evals } = game([20, 20, 20, -400, -400, -400, -400, -400]);
    expect(sorted(criticalPlies(fens, evals, { swings: 0 }))).toEqual([2, 3]);
  });

  it('measures the loss for the side that moved', () => {
    // Black moves at ply 1 and lets the score go from 0 to +400 for White: that is Black losing.
    // White improving at ply 0 (the same swing the other way) is not a loss.
    const down = game([0, 0, 400]);
    expect(sorted(criticalPlies(down.fens, down.evals, { swings: 0 }))).toEqual([1, 2]);
    const up = game([-400, 0, 0]);
    expect(criticalPlies(up.fens, up.evals, { swings: 0 })).toEqual([]);
  });

  it('orders by loss, largest first', () => {
    // White loses a little at ply 2 and a lot at ply 4.
    const { fens, evals } = game([0, 0, 0, -100, -100, -700, -700]);
    const out = criticalPlies(fens, evals, { swings: 0 });
    expect(out.slice(0, 2)).toEqual([4, 5]);
    expect(sorted(out)).toEqual([2, 3, 4, 5]);
  });

  it('adds the three largest swings even when no move reaches the loss threshold', () => {
    // Each swing is a gain for the side that moves, so no loss; the three biggest steps still count.
    const { fens, evals } = game([0, 120, 120, 240, 240, 345, 345, 350, 350, 352]);
    const out = criticalPlies(fens, evals, { minLoss: 10 });
    expect(new Set(out).size).toBe(out.length);
    expect(sorted(out)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('adds great and brilliant moves from the first-pass classes', () => {
    const { fens, evals } = game([20, 20, 20, 20, 20, 20]);
    const classes = [undefined, 'great', undefined, 'brilliant', undefined] as const;
    expect(sorted(criticalPlies(fens, evals, { classes, swings: 0 }))).toEqual([1, 2, 3, 4]);
  });

  /** White gives away `drop(i)` at each of its moves and Black hands it straight back; every White move is a loss. */
  const whiteSlips = (moves: number, drop: (i: number) => number) => {
    const cps = [0];
    for (let i = 0; i < moves; i++) cps.push(i % 2 === 0 ? -drop(i) : 0);
    return game(cps);
  };

  it('caps the list and keeps the highest losses', () => {
    const { fens, evals } = whiteSlips(40, (i) => 50 + i * 5);
    const out = criticalPlies(fens, evals, { maxPositions: 10, swings: 0 });
    expect(out).toHaveLength(10);
    expect(out.slice(0, 2)).toEqual([38, 39]); // the biggest slip comes first
    expect(Math.min(...out)).toBeGreaterThanOrEqual(30);
  });

  it('defaults to a cap of 40 positions', () => {
    const { fens, evals } = whiteSlips(120, () => 150);
    expect(criticalPlies(fens, evals).length).toBe(40);
  });

  it('caps phones at 24 positions and desktops at 40', () => {
    expect(keyPositionCap(true)).toBe(MOBILE_MAX_KEY_POSITIONS);
    expect(keyPositionCap(false)).toBe(MAX_KEY_POSITIONS);
    expect(MOBILE_MAX_KEY_POSITIONS).toBe(24);
    const { fens, evals } = whiteSlips(120, () => 150);
    expect(criticalPlies(fens, evals, { maxPositions: keyPositionCap(true) })).toHaveLength(24);
    expect(criticalPlies(fens, evals, { maxPositions: keyPositionCap(false) })).toHaveLength(40);
  });

  it('never leaves half a pair when the cap is odd', () => {
    const { fens, evals } = game([0, -300, -300, -300, -300, -600, -600]);
    expect(criticalPlies(fens, evals, { maxPositions: 4, swings: 0 })).toEqual([0, 1, 4, 5]);
    expect(criticalPlies(fens, evals, { maxPositions: 3, swings: 0 })).toEqual([0, 1]);
  });

  it('never returns finished positions', () => {
    const { fens, evals } = game([0, 0, 0, -900]);
    evals[3] = { fen: fens[3], depth: 0, source: 'terminal', lines: [], score: { cp: -900 }, terminal: 'draw' };
    expect(criticalPlies(fens, evals, { swings: 0 })).toEqual([2]);
  });

  it('copes with missing evaluations', () => {
    const { fens, evals } = game([0, 0, -900, -900]);
    expect(() => criticalPlies(fens, [evals[0], undefined, evals[2], evals[3]])).not.toThrow();
  });
});

describe('positionsToRefine', () => {
  it('keeps only positions shallower than the target depth', () => {
    const evals = [ev(0, 0, 18), ev(1, 0, 30), ev(2, 0, 24), ev(3, 0, 18)];
    expect(positionsToRefine(evals, [0, 1, 2, 3], 24)).toEqual([0, 3]);
  });
});
