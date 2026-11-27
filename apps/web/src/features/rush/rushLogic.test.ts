import { describe, expect, it } from 'vitest';
import type { Puzzle } from '@knightfall/core';
import type { RushRun } from '../../shared/db.ts';
import { applyResult, clockElapsed, clockRemaining, formatClock, initialCore, pauseClock, resumeClock, startClock, MAX_STRIKES, modeHistory, summarize, toRushRun, type RushAttempt } from './rushLogic.ts';

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

describe('run clock', () => {
  it('counts down normally while running', () => {
    const c = startClock(1000, 180_000);
    expect(clockRemaining(c, 1000)).toBe(180_000);
    expect(clockRemaining(c, 31_000)).toBe(150_000);
    expect(clockElapsed(c, 31_000)).toBe(30_000);
  });

  it('a 3 s load does not reduce the remaining time', () => {
    let c = startClock(0, 180_000);
    c = pauseClock(c, 10_000);
    expect(clockRemaining(c, 11_500)).toBe(170_000);
    expect(clockRemaining(c, 13_000)).toBe(170_000);
    c = resumeClock(c, 13_000);
    expect(clockRemaining(c, 13_000)).toBe(170_000);
    expect(clockRemaining(c, 15_000)).toBe(168_000);
    expect(clockElapsed(c, 15_000)).toBe(12_000);
  });

  it('pausing twice or resuming while running changes nothing', () => {
    let c = pauseClock(startClock(0, 60_000), 5_000);
    expect(pauseClock(c, 9_000).pausedAt).toBe(5_000);
    c = resumeClock(c, 8_000);
    expect(resumeClock(c, 20_000)).toBe(c);
  });

  it('the clock still runs out after the waits, and survival has no limit', () => {
    let c = startClock(0, 10_000);
    c = resumeClock(pauseClock(c, 2_000), 7_000);
    expect(clockRemaining(c, 14_999)).toBe(1);
    expect(clockRemaining(c, 15_000)).toBe(0);
    const s = startClock(0, null);
    expect(clockElapsed(resumeClock(pauseClock(s, 1_000), 4_000), 6_000)).toBe(3_000);
  });

  it('strikes still end the run as before', () => {
    let core = initialCore();
    let out = applyResult(core, att(0, 600, false));
    core = out.core;
    for (let i = 1; i < MAX_STRIKES; i++) {
      out = applyResult(core, att(i, 600, false));
      core = out.core;
    }
    expect(out.struckOut).toBe(true);
  });
});
