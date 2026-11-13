import { describe, expect, it } from 'vitest';
import {
  averageCpLoss, centipawnLoss, estimatedRating, formatScore, gameAccuracy, moveAccuracy, scoreToCp, winPercent, winPercentFor,
} from './winning.ts';

describe('winPercent', () => {
  it('is 50 for an equal position and symmetric around it', () => {
    expect(winPercent({ cp: 0 })).toBe(50);
    expect(winPercent({ cp: 150 }) + winPercent({ cp: -150 })).toBeCloseTo(100, 10);
  });
  it('matches the Lichess curve (k = 0.00368208)', () => {
    expect(winPercent({ cp: 100 })).toBeCloseTo(59.1, 1);
    expect(winPercent({ cp: 300 })).toBeCloseTo(75.1, 1);
    expect(winPercent({ cp: -500 })).toBeCloseTo(13.7, 1);
  });
  it('clamps centipawns to +/-1000 and maps mate to 100 / 0', () => {
    expect(winPercent({ cp: 5000 })).toBe(winPercent({ cp: 1000 }));
    expect(winPercent({ cp: 1000 })).toBeCloseTo(97.5, 1);
    expect(winPercent({ mate: 3 })).toBe(100);
    expect(winPercent({ mate: -1 })).toBe(0);
  });
  it('flips for Black', () => {
    expect(winPercentFor({ cp: 300 }, 'b')).toBeCloseTo(24.9, 1);
    expect(winPercentFor({ mate: -2 }, 'b')).toBe(100);
  });
});

describe('moveAccuracy', () => {
  it('is 100 when nothing was lost or the position improved', () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(40, 55)).toBe(100);
  });
  it('follows 103.1668 * e^(-0.04354 * drop) - 3.1669', () => {
    expect(moveAccuracy(60, 50)).toBeCloseTo(103.1668 * Math.exp(-0.4354) - 3.1669, 6);
    expect(moveAccuracy(60, 50)).toBeCloseTo(63.6, 1);
    expect(moveAccuracy(80, 60)).toBeCloseTo(40.0, 1);
  });
  it('never leaves 0..100', () => {
    expect(moveAccuracy(100, 0)).toBe(0);
    expect(moveAccuracy(50.0001, 50)).toBeLessThanOrEqual(100);
  });
});

describe('gameAccuracy', () => {
  it('is 100 for both sides when the evaluation never moves', () => {
    const flat = Array.from({ length: 41 }, () => 50);
    expect(gameAccuracy(flat, 'w')).toBeCloseTo(100, 6);
    expect(gameAccuracy(flat, 'b')).toBeCloseTo(100, 6);
  });
  it('charges a blunder only to the side that made it', () => {
    // 20 moves; Black's 5th move (index 9) drops White's win chance from 50 to 90.
    const win = Array.from({ length: 21 }, (_, i) => (i <= 9 ? 50 : 90));
    const white = gameAccuracy(win, 'w')!;
    const black = gameAccuracy(win, 'b')!;
    expect(white).toBeCloseTo(100, 6);
    expect(black).toBeLessThan(80);
    expect(black).toBeGreaterThan(0);
  });
  it('uses each side\'s own move count as the denominator', () => {
    // 3 moves (W, B, W). White errs on both of its moves, Black is perfect.
    const win = [50, 30, 30, 10];
    expect(gameAccuracy(win, 'b')).toBeCloseTo(100, 6);
    const expected = moveAccuracy(50, 30);
    expect(gameAccuracy(win, 'w')).toBeCloseTo(expected, 6);
  });
  it('respects the side to move in the start position', () => {
    // Black moves first and blunders at once.
    const win = [50, 90, 90];
    expect(gameAccuracy(win, 'b', 'b')).toBeLessThan(40);
    expect(gameAccuracy(win, 'w', 'b')).toBeCloseTo(100, 6);
  });
  it('returns null without moves for that side', () => {
    expect(gameAccuracy([50], 'w')).toBeNull();
    expect(gameAccuracy([50, 50], 'b')).toBeNull();
    expect(gameAccuracy([50, 50], 'w')).toBeCloseTo(100, 6);
  });
  it('weighs errors in volatile stretches more than the plain mean would', () => {
    // 40 moves; White loses 20 points once in a wild stretch and plays 19 perfect moves.
    const win = Array.from({ length: 41 }, () => 50);
    for (let i = 20; i <= 26; i++) win[i] = i % 2 === 0 ? 50 : 70; // swings caused by Black, taken back by Black
    win[26] = 50;
    win[27] = 30; // White's move 14 (index 26) drops 20
    for (let i = 28; i <= 40; i++) win[i] = 30;
    const plainMean = (19 * 100 + moveAccuracy(50, 30)) / 20;
    expect(gameAccuracy(win, 'w')!).toBeLessThan(plainMean);
  });
});

describe('centipawn loss and rating estimate', () => {
  it('measures loss from the mover\'s side and never goes negative', () => {
    expect(centipawnLoss({ cp: 50 }, { cp: -70 }, 'w')).toBe(120);
    expect(centipawnLoss({ cp: 50 }, { cp: -70 }, 'b')).toBe(0);
    expect(centipawnLoss({ cp: -50 }, { cp: 70 }, 'b')).toBe(120);
    expect(centipawnLoss({ cp: 200 }, { mate: -3 }, 'w')).toBe(1200);
    expect(scoreToCp({ mate: 4 })).toBe(1000);
  });
  it('averages', () => {
    expect(averageCpLoss([])).toBeNull();
    expect(averageCpLoss([0, 30, 60])).toBe(30);
  });
  it('maps ACPL to a rounded, bounded rating that falls as ACPL rises', () => {
    expect(estimatedRating(0)).toBe(3000);
    expect(estimatedRating(30)).toBe(2300);
    expect(estimatedRating(100)).toBe(1150);
    expect(estimatedRating(1000)).toBe(400);
    expect(estimatedRating(20)).toBeGreaterThan(estimatedRating(60));
    expect(estimatedRating(47) % 50).toBe(0);
  });
});

describe('formatScore', () => {
  it('prints pawns, mates and checkmate', () => {
    expect(formatScore({ cp: 35 })).toBe('+0.35');
    expect(formatScore({ cp: -120 })).toBe('-1.20');
    expect(formatScore({ cp: 0 })).toBe('0.00');
    expect(formatScore({ mate: 5 })).toBe('M5');
    expect(formatScore({ mate: -3 })).toBe('-M3');
    expect(formatScore({ mate: 1 }, true)).toBe('#');
  });
});
