import { describe, expect, it } from 'vitest';
import { estimateGameRating, RATING_DEFAULT_ANCHOR, RATING_FIT, RATING_MAX_SHIFT, RATING_PER_ACCURACY_POINT, typicalAccuracyAt } from './rating.ts';

describe('typicalAccuracyAt', () => {
  it('is the linear fit', () => {
    expect(RATING_FIT).toEqual({ intercept: 61.2, slope: 0.00918 });
    expect(typicalAccuracyAt(1600)).toBeCloseTo(75.888, 6);
    expect(typicalAccuracyAt(0)).toBeCloseTo(61.2, 6);
  });
  it('moves half as far as the raw fit would', () => {
    expect(RATING_PER_ACCURACY_POINT).toBeCloseTo(1 / 0.00918 / 2, 6);
    expect(RATING_PER_ACCURACY_POINT).toBeCloseTo(54.466, 2);
  });
});

describe('estimateGameRating', () => {
  it('returns the anchor for typical accuracy at that rating', () => {
    expect(estimateGameRating(typicalAccuracyAt(1200), 1200)).toBe(1200);
    expect(estimateGameRating(typicalAccuracyAt(2000), 2000)).toBe(2000);
  });
  it('moves up or down from the anchor and rounds to 50', () => {
    // (80 - 75.888) * 54.466 = +224 -> 1824 -> 1800
    expect(estimateGameRating(80, 1600)).toBe(1800);
    // (70 - 75.888) * 54.466 = -320.7 -> 1279.3 -> 1300
    expect(estimateGameRating(70, 1600)).toBe(1300);
    expect(estimateGameRating(75.9, 1600)! % 50).toBe(0);
    expect(estimateGameRating(86.5, 1510)! % 50).toBe(0);
  });
  it('stays within 600 of the anchor', () => {
    expect(RATING_MAX_SHIFT).toBe(600);
    expect(estimateGameRating(100, 1600)).toBe(2200);
    expect(estimateGameRating(0, 1600)).toBe(1000);
    expect(estimateGameRating(100, 1000)).toBe(1600);
    expect(estimateGameRating(0, 1500)).toBe(900);
  });
  it('is clamped to 100..3200', () => {
    expect(estimateGameRating(0, 200)).toBe(100);
    expect(estimateGameRating(100, 3000)).toBe(3200);
  });
  it('is null without an accuracy', () => {
    expect(estimateGameRating(null)).toBeNull();
    expect(estimateGameRating(null, 1500)).toBeNull();
    expect(estimateGameRating(Number.NaN, 1500)).toBeNull();
  });
  it('anchors on 1600 when the rating is unknown or unusable', () => {
    expect(RATING_DEFAULT_ANCHOR).toBe(1600);
    const reference = estimateGameRating(80, 1600);
    expect(estimateGameRating(80)).toBe(reference);
    expect(estimateGameRating(80, null)).toBe(reference);
    expect(estimateGameRating(80, undefined)).toBe(reference);
    expect(estimateGameRating(80, 0)).toBe(reference);
    expect(estimateGameRating(80, -300)).toBe(reference);
    expect(estimateGameRating(80, Number.NaN)).toBe(reference);
  });
});
