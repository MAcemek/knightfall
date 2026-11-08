import { describe, expect, it } from 'vitest';
import {
  judgeMove, validateLine, glickoUpdate, puzzleRatingChange, DEFAULT_GLICKO, eloUpdate,
  pickIndex, rampRating, bucketFor, dailyIndex, dailyStreak, utcDateKey, rowToPuzzle,
  isPlayerPly, playerMoveCount, hashString,
} from './index.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('judgeMove', () => {
  // Back-rank mate: white Ra1 Kg1, black Kg8 with pawns f7 g7 h7.
  const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
  it('accepts the expected move', () => expect(judgeMove(fen, 'a1a8', 'a1a8')).toBe('correct'));
  it('rejects a wrong move', () => expect(judgeMove(fen, 'a1a8', 'a1a7')).toBe('wrong'));
  it('rejects illegal moves', () => expect(judgeMove(fen, 'a1a8', 'a1h8')).toBe('wrong'));
  it('accepts an alternative checkmate', () => {
    const twoRooks = '6k1/5ppp/8/8/8/8/5PPP/RR4K1 w - - 0 1';
    expect(judgeMove(twoRooks, 'a1a8', 'b1b8')).toBe('mate');
  });
});

describe('validateLine', () => {
  it('accepts a legal line', () => expect(validateLine(START, ['e2e4', 'e7e5'])).toBeNull());
  it('reports an illegal move', () => expect(validateLine(START, ['e2e5'])).toMatch(/Illegal/));
});

describe('ratings', () => {
  it('winning vs an equal opponent raises rating and shrinks RD', () => {
    const r = glickoUpdate({ rating: 1500, rd: 200, vol: 0.06 }, 1500, 80, 1);
    expect(r.rating).toBeGreaterThan(1500);
    expect(r.rd).toBeLessThan(200);
  });
  it('solving raises and failing lowers rating', () => {
    expect(puzzleRatingChange(DEFAULT_GLICKO, 1200, true).delta).toBeGreaterThan(0);
    expect(puzzleRatingChange(DEFAULT_GLICKO, 1200, false).delta).toBeLessThan(0);
  });
  it('beating a harder puzzle gives more points', () => {
    const p = { rating: 1500, rd: 80, vol: 0.06 };
    expect(puzzleRatingChange(p, 1900, true).delta).toBeGreaterThan(puzzleRatingChange(p, 1100, true).delta);
  });
  it('elo is symmetric', () => {
    expect(eloUpdate(1500, 1500, 1) - 1500).toBe(1500 - eloUpdate(1500, 1500, 0));
  });
});

describe('sequencing', () => {
  it('is deterministic per seed', () => {
    const a = Array.from({ length: 20 }, (_, i) => pickIndex(12345, i, 1000));
    const b = Array.from({ length: 20 }, (_, i) => pickIndex(12345, i, 1000));
    expect(a).toEqual(b);
    const c = Array.from({ length: 20 }, (_, i) => pickIndex(999, i, 1000));
    expect(c).not.toEqual(a);
  });
  it('ramps up and clamps buckets', () => {
    expect(rampRating(0)).toBe(400);
    expect(rampRating(10)).toBeGreaterThan(rampRating(5));
    expect(bucketFor(150)).toBe(400);
    expect(bucketFor(3500)).toBe(2900);
    expect(bucketFor(1234)).toBe(1200);
  });
});

describe('daily', () => {
  it('is stable per date and varies across dates', () => {
    expect(dailyIndex('2026-11-08', 5000)).toBe(dailyIndex('2026-11-08', 5000));
    const days = Array.from({ length: 30 }, (_, i) => dailyIndex(`2026-11-${String(i + 1).padStart(2, '0')}`, 5000));
    expect(new Set(days).size).toBeGreaterThan(25);
  });
  it('counts streaks', () => {
    expect(dailyStreak(['2026-11-06', '2026-11-07', '2026-11-08'], '2026-11-08')).toBe(3);
    expect(dailyStreak(['2026-11-06', '2026-11-07'], '2026-11-08')).toBe(2);
    expect(dailyStreak(['2026-11-05'], '2026-11-08')).toBe(0);
    expect(utcDateKey(new Date('2026-11-08T23:59:00Z'))).toBe('2026-11-08');
  });
});

describe('puzzle helpers', () => {
  it('parses rows and identifies solver plies', () => {
    const p = rowToPuzzle(['abc', START, 'e2e4 e7e5 g1f3 b8c6', 1500, 'fork short']);
    expect(p.moves).toHaveLength(4);
    expect(isPlayerPly(p, 0)).toBe(false);
    expect(isPlayerPly(p, 1)).toBe(true);
    expect(playerMoveCount(p)).toBe(2);
    expect(p.themes).toEqual(['fork', 'short']);
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
