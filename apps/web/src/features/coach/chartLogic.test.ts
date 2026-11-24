import { describe, expect, it } from 'vitest';
import { buildChart, nearestDot, niceTicks, pathOf, shortDate } from './chartLogic.ts';
import { targetLine } from './progressLogic.ts';
import { emptyBaselines, emptyTargets } from './planLogic.ts';

const size = { width: 400, height: 200, pad: { left: 40, right: 10, top: 10, bottom: 30 } };

describe('niceTicks', () => {
  it('covers the range with round values', () => {
    const t = niceTicks(1180, 1342, 4);
    expect(t[0]).toBeLessThanOrEqual(1180);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(1342);
  });
  it('gives two ticks for a single value', () => {
    expect(niceTicks(1200, 1200).length).toBeGreaterThanOrEqual(2);
  });
  it('uses whole numbers for a flat or nearly flat range', () => {
    for (const [a, b] of [[1200, 1200], [1500, 1502], [1300, 1301]]) {
      const t = niceTicks(a, b);
      expect(t.every(Number.isInteger)).toBe(true);
      expect(t[0]).toBeLessThanOrEqual(a);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(b);
    }
  });
  it('gives nothing for non-numbers', () => {
    expect(niceTicks(NaN, 1)).toEqual([]);
  });
});

describe('buildChart', () => {
  const ratings = [
    { date: '2026-01-01', rating: 1200 },
    { date: '2026-01-11', rating: 1250 },
  ];
  it('puts the first date at the left and the last at the right', () => {
    const m = buildChart(ratings, null, size);
    expect(m.dots[0].x).toBe(40);
    expect(m.dots[1].x).toBe(390);
    expect(m.dots[1].y).toBeLessThan(m.dots[0].y);
    expect(m.line).toEqual([]);
    expect(m.dots[0].target).toBeNull();
  });
  it('includes the target line in the scales and reads it at each dot', () => {
    const b = emptyBaselines();
    b.rapid = 1200;
    const t = emptyTargets();
    t.rapid = { three: 1270, six: 1325 };
    const line = targetLine({ startDate: '2026-01-01', baselines: b, targets: t }, 'rapid')!;
    const m = buildChart(ratings, line, size);
    expect(m.line).toHaveLength(3);
    expect(m.dots[0].target).toBe(1200);
    expect(m.dots[1].target).toBeGreaterThan(1200);
    expect(m.line[2].x).toBeCloseTo(390);
    expect(Number(m.yTicks[m.yTicks.length - 1].label)).toBeGreaterThanOrEqual(1325);
  });
  it('copes with one point', () => {
    const m = buildChart([ratings[0]], null, size);
    expect(Number.isFinite(m.dots[0].x)).toBe(true);
    expect(Number.isFinite(m.dots[0].y)).toBe(true);
    expect(m.yTicks.every((t) => Number.isInteger(Number(t.label)))).toBe(true);
    expect(m.xTicks.map((t) => t.label)).toEqual(['1 Jan']);
  });
  it('copes with nothing', () => {
    expect(buildChart([], null, size).dots).toEqual([]);
  });
});

describe('helpers', () => {
  it('finds the nearest dot', () => {
    expect(nearestDot([{ x: 10 }, { x: 50 }, { x: 90 }], 60)).toBe(1);
    expect(nearestDot([], 5)).toBe(-1);
  });
  it('builds a path', () => {
    expect(pathOf([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M1.0 2.0 L3.0 4.0');
    expect(pathOf([])).toBe('');
  });
  it('writes short dates', () => {
    expect(shortDate('2026-03-05')).toBe('5 Mar');
  });
});
