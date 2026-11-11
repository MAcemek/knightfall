import { describe, expect, it } from 'vitest';
import { difficultyOffset, EMPTY_TALLY, MAX_THEMES, parseDifficulty, parseThemeParam, tally, tallyAccuracy, themeParam, toggleTheme, trainTargetRating } from './trainLogic.ts';

describe('parseThemeParam / themeParam', () => {
  it('keeps valid themes, drops junk and duplicates', () => {
    expect(parseThemeParam('fork+pin')).toEqual(['fork', 'pin']);
    expect(parseThemeParam('fork+nonsense+fork+middlegame')).toEqual(['fork']);
    expect(parseThemeParam('')).toEqual([]);
    expect(parseThemeParam(undefined)).toEqual([]);
  });
  it('caps the number of themes', () => {
    expect(parseThemeParam('fork+pin+skewer+sacrifice+mateIn2')).toHaveLength(MAX_THEMES);
  });
  it('round-trips', () => {
    expect(parseThemeParam(themeParam(['mateIn2', 'backRankMate']))).toEqual(['mateIn2', 'backRankMate']);
  });
});

describe('toggleTheme', () => {
  it('adds, removes, and drops the oldest beyond the cap', () => {
    expect(toggleTheme([], 'fork')).toEqual(['fork']);
    expect(toggleTheme(['fork', 'pin'], 'fork')).toEqual(['pin']);
    expect(toggleTheme(['fork', 'pin', 'skewer'], 'sacrifice')).toEqual(['pin', 'skewer', 'sacrifice']);
  });
});

describe('difficulty', () => {
  it('parses with a normal fallback', () => {
    expect(parseDifficulty('easier')).toBe('easier');
    expect(parseDifficulty('harder')).toBe('harder');
    expect(parseDifficulty('wat')).toBe('normal');
    expect(parseDifficulty(null)).toBe('normal');
  });
  it('shifts and clamps the target rating', () => {
    expect(difficultyOffset('easier')).toBe(-200);
    expect(trainTargetRating(1500.4, 'harder')).toBe(1700);
    expect(trainTargetRating(450, 'easier')).toBe(400);
    expect(trainTargetRating(2850, 'harder')).toBe(2900);
  });
});

describe('tally', () => {
  it('tracks accuracy and streaks', () => {
    let t = EMPTY_TALLY;
    expect(tallyAccuracy(t)).toBe('–');
    for (const s of [true, true, false, true]) t = tally(t, s);
    expect(t).toEqual({ attempted: 4, solved: 3, streak: 1, bestStreak: 2 });
    expect(tallyAccuracy(t)).toBe('75%');
  });
});
