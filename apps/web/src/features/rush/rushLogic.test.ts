import { describe, expect, it } from 'vitest';
import type { Puzzle } from '@knightfall/core';
import type { RushRun } from '../../shared/db.ts';
import { applyResult, formatClock, initialCore, MAX_STRIKES, modeHistory, summarize, toRushRun, type RushAttempt } from './rushLogic.ts';

const pz = (id: string, rating: number): Puzzle => ({ id, fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: [], opponentFirst: true, rating, themes: [], source: 'lichess' });
const att = (index: number, rating: number, solved: boolean, timeMs = 1000): RushAttempt => ({ index, puzzle: pz(`p${index}`, rating), solved, timeMs });

describe('applyResult', () => {
  it('scores and builds combo on solves', () => {
    let core = initialCore();
    for (let i = 0; i < 4; i++) core = applyResult(core, att(i, 600, true)).core;
    expect(core.score).toBe(4);
    expect(core.combo).toBe(4);
    const r = applyResult(core, att(4, 700, true));
    expect(r.milestone).toBe(true);
    expect(r.core.bestCombo).toBe(5);
  });

  it('resets combo and adds a strike on a miss; third strike ends the run', () => {
    let core = applyResult(initialCore(), att(0, 600, true)).core;
    let r = applyResult(core, att(1, 650, false));
    expect(r.core.combo).toBe(0);
    expect(r.core.bestCombo).toBe(1);
    expect(r.core.strikes).toBe(1);
    expect(r.struckOut).toBe(false);
    core = applyResult(r.core, att(2, 650, false)).core;
    r = applyResult(core, att(3, 650, false));
    expect(r.core.strikes).toBe(MAX_STRIKES);
    expect(r.struckOut).toBe(true);
    expect(r.core.attempts).toHaveLength(4);
  });
});

describe('summarize', () => {
  it('handles an empty run', () => {
    const s = summarize(initialCore());
    expect(s.accuracy).toBeNull();
    expect(s.avgTimeMs).toBeNull();
    expect(s.highestSolved).toBeNull();
  });
  it('computes accuracy, avg time and highest solved', () => {
    let core = initialCore();
    core = applyResult(core, att(0, 600, true, 2000)).core;
    core = applyResult(core, att(1, 1500, false, 4000)).core;
    core = applyResult(core, att(2, 900, true, 3000)).core;
    const s = summarize(core);
    expect(s.accuracy).toBeCloseTo(2 / 3);
    expect(s.avgTimeMs).toBe(3000);
    expect(s.highestSolved).toBe(900);
    expect(toRushRun('3min', core, 5).highestRating).toBe(900);
  });
});

describe('formatClock', () => {
  it('rounds countdowns up and elapsed down', () => {
    expect(formatClock(180_000)).toBe('3:00');
    expect(formatClock(9_001)).toBe('0:10');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-50)).toBe('0:00');
    expect(formatClock(61_999, 'up')).toBe('1:01');
  });
});

describe('modeHistory', () => {
  it('returns best and newest-first last five for the mode', () => {
    const runs: RushRun[] = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ mode: '3min', score: i * 3 % 11, strikes: 3, bestCombo: 1, highestRating: 0, puzzles: [], at: i }));
    runs.push({ mode: 'survival', score: 99, strikes: 3, bestCombo: 1, highestRating: 0, puzzles: [], at: 100 });
    const h = modeHistory(runs, '3min');
    expect(h.runs).toBe(7);
    expect(h.best).toBe(Math.max(...runs.filter((r) => r.mode === '3min').map((r) => r.score)));
    expect(h.last).toEqual([7, 6, 5, 4, 3].map((i) => i * 3 % 11));
    expect(modeHistory(runs, '5min').best).toBeNull();
  });
});
