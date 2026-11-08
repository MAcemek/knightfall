import { describe, expect, it } from 'vitest';
import { DEFAULT_GLICKO } from '@knightfall/core';
import { nextStreak, ratedOutcome, sortThemes, themeLabel } from './logic.ts';

describe('ratedOutcome', () => {
  it('gains on a clean solve', () => {
    const r = ratedOutcome(DEFAULT_GLICKO, 1200, true, 0);
    expect(r.applied).toBe(true);
    expect(r.clean).toBe(true);
    expect(r.delta).toBeGreaterThan(0);
    expect(r.next.rating).toBeGreaterThan(DEFAULT_GLICKO.rating);
  });

  it('gives nothing for a hinted solve', () => {
    const r = ratedOutcome(DEFAULT_GLICKO, 1200, true, 2);
    expect(r).toEqual({ next: DEFAULT_GLICKO, delta: 0, applied: false, clean: false });
  });

  it('always applies the loss on a fail, even with hints', () => {
    const a = ratedOutcome(DEFAULT_GLICKO, 1200, false, 0);
    const b = ratedOutcome(DEFAULT_GLICKO, 1200, false, 1);
    expect(a.delta).toBeLessThan(0);
    expect(b.delta).toBe(a.delta);
    expect(b.applied).toBe(true);
  });
});

describe('nextStreak', () => {
  it('increments on clean solves and flags milestones', () => {
    const s = nextStreak({ current: 4, best: 10 }, true, true);
    expect(s.streak).toEqual({ current: 5, best: 10 });
    expect(s.incremented).toBe(true);
    expect(s.milestone).toBe(true);
    expect(s.newBest).toBe(false);
  });

  it('flags a new best', () => {
    const s = nextStreak({ current: 6, best: 6 }, true, true);
    expect(s.streak).toEqual({ current: 7, best: 7 });
    expect(s.newBest).toBe(true);
  });

  it('does not celebrate tiny bests', () => {
    expect(nextStreak({ current: 0, best: 0 }, true, true).newBest).toBe(false);
  });

  it('resets on a fail and keeps best', () => {
    const s = nextStreak({ current: 3, best: 8 }, false, false);
    expect(s.streak).toEqual({ current: 0, best: 8 });
    expect(s.broken).toBe(true);
  });

  it('is unchanged on a hinted solve', () => {
    const prev = { current: 3, best: 8 };
    expect(nextStreak(prev, true, false).streak).toBe(prev);
  });
});

describe('themes', () => {
  it('humanizes camelCase', () => {
    expect(themeLabel('mateIn2')).toBe('Mate in 2');
    expect(themeLabel('advancedPawn')).toBe('Advanced pawn');
    expect(themeLabel('fork')).toBe('Fork');
  });
  it('puts motifs before length tags', () => {
    expect(sortThemes(['short', 'fork', 'middlegame', 'pin'])).toEqual(['fork', 'pin', 'short', 'middlegame']);
  });
});
