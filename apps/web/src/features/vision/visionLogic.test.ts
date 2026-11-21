import { describe, expect, it } from 'vitest';
import {
  accuracyPercent,
  clockText,
  isKnightMove,
  isLightSquare,
  knightDistance,
  knightMoves,
  knightRoute,
  nameChoices,
  parseColor,
  parseSquare,
  randomSquare,
  recordBest,
  remainingMs,
  sanitizeBests,
  screenSquares,
  squareName,
  type Rng,
} from './visionLogic.ts';

/** Small deterministic generator (mulberry32) so tests are repeatable. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sq = (name: string) => {
  const s = parseSquare(name);
  if (s === null) throw new Error(name);
  return s;
};

describe('squares', () => {
  it('names and parses squares both ways', () => {
    expect(squareName(0)).toBe('a1');
    expect(squareName(7)).toBe('h1');
    expect(squareName(28)).toBe('e4');
    expect(squareName(63)).toBe('h8');
    for (let i = 0; i < 64; i++) expect(parseSquare(squareName(i))).toBe(i);
    expect(parseSquare('E4')).toBe(28);
    expect(parseSquare('i9')).toBeNull();
    expect(parseSquare('')).toBeNull();
  });

  it('colours a1 dark and h1 light, like a real board', () => {
    expect(isLightSquare(sq('a1'))).toBe(false);
    expect(isLightSquare(sq('h1'))).toBe(true);
    expect(isLightSquare(sq('d4'))).toBe(false);
    expect(isLightSquare(sq('e4'))).toBe(true);
  });

  it('lays the board out from White with a8 top-left and from Black with h1 top-left', () => {
    const w = screenSquares('w');
    expect(w).toHaveLength(64);
    expect(squareName(w[0])).toBe('a8');
    expect(squareName(w[7])).toBe('h8');
    expect(squareName(w[56])).toBe('a1');
    expect(squareName(w[63])).toBe('h1');
    const b = screenSquares('b');
    expect(squareName(b[0])).toBe('h1');
    expect(squareName(b[63])).toBe('a8');
    expect(new Set(b).size).toBe(64);
  });

  it('reads the side from the URL, defaulting to White', () => {
    expect(parseColor('b')).toBe('b');
    expect(parseColor('w')).toBe('w');
    expect(parseColor(null)).toBe('w');
    expect(parseColor('x')).toBe('w');
  });

  it('never repeats the previous square back to back', () => {
    const rng = seeded(1);
    let last = randomSquare(rng);
    for (let i = 0; i < 500; i++) {
      const next = randomSquare(rng, last);
      expect(next).not.toBe(last);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(64);
      last = next;
    }
  });
});

describe('nameChoices', () => {
  it('gives four distinct squares with the answer among them', () => {
    const rng = seeded(7);
    for (let answer = 0; answer < 64; answer++) {
      const choices = nameChoices(rng, answer);
      expect(choices).toHaveLength(4);
      expect(new Set(choices).size).toBe(4);
      expect(choices).toContain(answer);
    }
  });

  it('uses near misses (mirror squares and neighbours) as the wrong answers', () => {
    const near = new Set(['e5', 'd4', 'f4', 'e3'].map(sq)); // e4: mirrored e5 and d4, neighbours d4 f4 e5 e3
    const choices = nameChoices(seeded(3), sq('e4')).filter((c) => c !== sq('e4'));
    for (const c of choices) expect(near.has(c)).toBe(true);
  });

  it('works in a corner, where there are fewer neighbours', () => {
    const choices = nameChoices(seeded(11), sq('a1'));
    expect(new Set(choices).size).toBe(4);
    expect(choices).toContain(sq('a1'));
  });
});

describe('knight', () => {
  it('lists knight moves, two from a corner and eight in the middle', () => {
    expect(knightMoves(sq('a1')).map(squareName).sort()).toEqual(['b3', 'c2']);
    expect(knightMoves(sq('d4'))).toHaveLength(8);
    expect(isKnightMove(sq('g1'), sq('f3'))).toBe(true);
    expect(isKnightMove(sq('g1'), sq('g3'))).toBe(false);
  });

  it('measures the fewest moves between squares', () => {
    expect(knightDistance(sq('e4'), sq('e4'))).toBe(0);
    expect(knightDistance(sq('g1'), sq('f3'))).toBe(1);
    expect(knightDistance(sq('a1'), sq('b2'))).toBe(4); // the famous corner case
    expect(knightDistance(sq('a1'), sq('h8'))).toBe(6);
    expect(knightDistance(sq('e4'), sq('e5'))).toBe(3);
  });

  it('builds routes inside the asked range with the right minimum', () => {
    const rng = seeded(5);
    for (let i = 0; i < 200; i++) {
      const r = knightRoute(rng, 2, 4);
      expect(r.min).toBeGreaterThanOrEqual(2);
      expect(r.min).toBeLessThanOrEqual(4);
      expect(knightDistance(r.from, r.to)).toBe(r.min);
    }
  });

  it('can start the next route somewhere new', () => {
    const rng = seeded(9);
    let r = knightRoute(rng);
    for (let i = 0; i < 100; i++) {
      const next = knightRoute(rng, 2, 4, r.from);
      expect(next.from).not.toBe(r.from);
      r = next;
    }
  });
});

describe('clock and score', () => {
  it('counts down and stops at zero', () => {
    expect(remainingMs(1000, 1000, 30_000)).toBe(30_000);
    expect(remainingMs(1000, 11_000, 30_000)).toBe(20_000);
    expect(remainingMs(1000, 99_000, 30_000)).toBe(0);
  });

  it('shows the clock rounded up', () => {
    expect(clockText(30_000)).toBe('0:30');
    expect(clockText(29_001)).toBe('0:30');
    expect(clockText(400)).toBe('0:01');
    expect(clockText(0)).toBe('0:00');
    expect(clockText(60_000)).toBe('1:00');
  });

  it('gives accuracy as a whole percent', () => {
    expect(accuracyPercent(0, 0)).toBeNull();
    expect(accuracyPercent(9, 1)).toBe(90);
    expect(accuracyPercent(2, 1)).toBe(67);
  });
});

describe('bests', () => {
  it('keeps only valid stored entries', () => {
    expect(sanitizeBests(null)).toEqual({});
    expect(sanitizeBests({ 'find-w': 12, 'name-b': -1, 'knight-w': 2.5, junk: 4, 'find-b': '3' })).toEqual({ 'find-w': 12 });
  });

  it('records a first score and only real improvements', () => {
    const first = recordBest({}, 'find', 'w', 10);
    expect(first).toEqual({ bests: { 'find-w': 10 }, isNew: true, previous: null });
    const same = recordBest(first.bests, 'find', 'w', 10);
    expect(same.isNew).toBe(false);
    expect(same.bests).toBe(first.bests);
    const better = recordBest(first.bests, 'find', 'w', 14);
    expect(better).toEqual({ bests: { 'find-w': 14 }, isNew: true, previous: 10 });
    expect(recordBest(first.bests, 'find', 'b', 3).bests).toEqual({ 'find-w': 10, 'find-b': 3 });
  });

  it('does not store a zero score as a best', () => {
    expect(recordBest({}, 'knight', 'w', 0)).toEqual({ bests: {}, isNew: false, previous: null });
  });
});
