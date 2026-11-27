import { describe, expect, it } from 'vitest';
import { DEFAULT_GLICKO } from '@knightfall/core';
import { shouldOfferStartLevel, startRating, START_LEVELS } from './startLevel.ts';

describe('shouldOfferStartLevel', () => {
  it('offers the choice to a brand-new player', () => {
    expect(shouldOfferStartLevel(0, DEFAULT_GLICKO)).toBe(true);
  });
  it('does not offer it once a rated puzzle was played', () => {
    expect(shouldOfferStartLevel(1, DEFAULT_GLICKO)).toBe(false);
  });
  it('does not offer it when the rating has moved or was chosen', () => {
    expect(shouldOfferStartLevel(0, { ...DEFAULT_GLICKO, rating: 1500 })).toBe(false);
    expect(shouldOfferStartLevel(0, { ...DEFAULT_GLICKO, rd: 200 })).toBe(false);
  });
});

describe('startRating', () => {
  it('maps each choice to its rating with the default RD', () => {
    expect(START_LEVELS.map((l) => startRating(l).rating)).toEqual([800, 1200, 1600]);
    for (const l of START_LEVELS) {
      expect(startRating(l).rd).toBe(DEFAULT_GLICKO.rd);
      expect(startRating(l).vol).toBe(DEFAULT_GLICKO.vol);
    }
  });
});
