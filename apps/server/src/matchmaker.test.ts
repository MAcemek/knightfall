import { describe, expect, it } from 'vitest';
import { allowedGap, findPairs, type QueueEntry } from './matchmaker.ts';
import { botSolveChance, botThinkMs } from './bot.ts';

const entry = (id: string, rating: number, since = 0): QueueEntry => ({
  participant: { id, isBot: false, info: { name: id, rating }, send: () => {} },
  rating,
  since,
});

const ids = (pairs: [QueueEntry, QueueEntry][]) => pairs.map(([a, b]) => [a.participant.id, b.participant.id].sort().join('+')).sort();

describe('findPairs', () => {
  it('pairs the closest ratings first', () => {
    const q = [entry('a', 1200), entry('b', 1500), entry('c', 1240), entry('d', 1530)];
    expect(ids(findPairs(q, 0))).toEqual(['a+c', 'b+d']);
  });
  it('does not pair far-apart players until the gap allowance has grown', () => {
    const q = [entry('a', 1000), entry('b', 1400)];
    expect(findPairs(q, 0)).toEqual([]);
    expect(findPairs(q, 6000)).toHaveLength(1);
  });
  it('gap grows with time but is capped', () => {
    expect(allowedGap(0)).toBe(100);
    expect(allowedGap(5000)).toBeGreaterThan(allowedGap(1000));
    expect(allowedGap(1e9)).toBe(1000);
  });
});

describe('bot tuning', () => {
  it('thinks 2–7.5s, faster when stronger', () => {
    const mid = () => 0.5;
    expect(botThinkMs(600, mid)).toBeGreaterThan(botThinkMs(2400, mid));
    for (const r of [400, 1200, 3000]) for (const x of [0, 0.999]) {
      const t = botThinkMs(r, () => x);
      expect(t).toBeGreaterThanOrEqual(2000);
      expect(t).toBeLessThanOrEqual(7_500);
    }
  });
  it('solve chance decreases with puzzle index', () => {
    expect(botSolveChance(1200, 0)).toBeGreaterThan(botSolveChance(1200, 20));
    expect(botSolveChance(1800, 20)).toBeGreaterThan(botSolveChance(1200, 20));
  });
});
