import { describe, expect, it } from 'vitest';
import { bucketSearchOrder, isTrainableTheme, matchesThemes, sortThemes, THEME_GROUPS, themeLabel, TRAINABLE_THEMES } from './themes.ts';

describe('themeLabel', () => {
  it('humanises camelCase tags', () => {
    expect(themeLabel('advancedPawn')).toBe('Advanced pawn');
    expect(themeLabel('mateIn2')).toBe('Mate in 2');
    expect(themeLabel('fork')).toBe('Fork');
  });
});

describe('sortThemes', () => {
  it('puts motifs before length/phase tags without mutating', () => {
    const input = ['short', 'fork', 'endgame', 'pin'];
    expect(sortThemes(input)).toEqual(['fork', 'pin', 'short', 'endgame']);
    expect(input).toEqual(['short', 'fork', 'endgame', 'pin']);
  });
});

describe('matchesThemes', () => {
  it('matches when any wanted theme is present', () => {
    expect(matchesThemes(['fork', 'short'], ['pin', 'fork'])).toBe(true);
    expect(matchesThemes(['fork', 'short'], ['pin'])).toBe(false);
  });
  it('treats an empty filter as match-all', () => {
    expect(matchesThemes([], [])).toBe(true);
    expect(matchesThemes(['fork'], [])).toBe(true);
  });
});

describe('bucketSearchOrder', () => {
  it('walks outward from the start, nearest first', () => {
    expect(bucketSearchOrder(1200, 400, 2900, 100).slice(0, 5)).toEqual([1200, 1100, 1300, 1000, 1400]);
  });
  it('covers every bucket exactly once', () => {
    const order = bucketSearchOrder(600, 400, 2900, 100);
    expect(order).toHaveLength(26);
    expect(new Set(order).size).toBe(26);
    expect(Math.min(...order)).toBe(400);
    expect(Math.max(...order)).toBe(2900);
  });
  it('clamps an out-of-range start', () => {
    expect(bucketSearchOrder(100, 400, 2900, 100)[0]).toBe(400);
    expect(bucketSearchOrder(5000, 400, 2900, 100)[0]).toBe(2900);
  });
});

describe('curated list', () => {
  it('has no duplicates and recognises its own keys', () => {
    expect(new Set(TRAINABLE_THEMES).size).toBe(TRAINABLE_THEMES.length);
    expect(THEME_GROUPS.every((g) => g.themes.length > 0)).toBe(true);
    expect(isTrainableTheme('fork')).toBe(true);
    expect(isTrainableTheme('middlegame')).toBe(false);
  });
});
