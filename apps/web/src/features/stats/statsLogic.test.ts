import { describe, expect, it } from 'vitest';
import {
  activeDayStreak, activityGrid, battleSummary, chartGeometry, formatDuration, heatLevel, localDateKey, ratingSeries, rushBests,
  strengthsAndWeaknesses, themeAccuracy, totals,
} from './statsLogic.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('ratingSeries', () => {
  it('keeps rated attempts with a rating, oldest first', () => {
    const s = ratingSeries([
      { mode: 'rated', ratingAfter: 1250, at: 30 },
      { mode: 'rush', ratingAfter: undefined, at: 20 },
      { mode: 'rated', ratingAfter: 1210, at: 10 },
      { mode: 'rated', ratingAfter: undefined, at: 5 },
    ]);
    expect(s).toEqual([{ at: 10, rating: 1210 }, { at: 30, rating: 1250 }]);
  });
  it('thins long histories but keeps the newest point', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ mode: 'rated' as const, ratingAfter: 1000 + i, at: i }));
    const s = ratingSeries(many, 100);
    expect(s).toHaveLength(100);
    expect(s[s.length - 1]).toEqual({ at: 999, rating: 1999 });
    expect(s.every((p, i) => i === 0 || p.at > s[i - 1].at)).toBe(true);
  });
});

describe('themeAccuracy', () => {
  const rows = [
    ...Array.from({ length: 6 }, () => ({ themes: ['fork', 'short'], solved: true })),
    ...Array.from({ length: 4 }, () => ({ themes: ['fork', 'middlegame'], solved: false })),
    ...Array.from({ length: 5 }, () => ({ themes: ['pin', 'mate'], solved: true })),
    ...Array.from({ length: 3 }, () => ({ themes: ['skewer'], solved: true })),
  ];
  it('aggregates per theme, skips generic tags and small samples, sorts best first', () => {
    expect(themeAccuracy(rows)).toEqual([
      { theme: 'pin', attempts: 5, solved: 5, accuracy: 1 },
      { theme: 'fork', attempts: 10, solved: 6, accuracy: 0.6 },
    ]);
  });
  it('honours minAttempts and counts a duplicated tag once per row', () => {
    expect(themeAccuracy(rows, 3).map((t) => t.theme)).toEqual(['pin', 'skewer', 'fork']);
    expect(themeAccuracy([{ themes: ['fork', 'fork'], solved: true }], 1)[0].attempts).toBe(1);
  });
});

describe('strengthsAndWeaknesses', () => {
  const stat = (theme: string, accuracy: number) => ({ theme, attempts: 10, solved: accuracy * 10, accuracy });
  it('splits without overlap, weaknesses worst first', () => {
    const list = [stat('a', 0.9), stat('b', 0.8), stat('c', 0.7), stat('d', 0.5), stat('e', 0.3)];
    const r = strengthsAndWeaknesses(list, 3);
    expect(r.strengths.map((t) => t.theme)).toEqual(['a', 'b', 'c']);
    expect(r.weaknesses.map((t) => t.theme)).toEqual(['e', 'd']);
  });
  it('handles short lists', () => {
    expect(strengthsAndWeaknesses([], 3)).toEqual({ strengths: [], weaknesses: [] });
    expect(strengthsAndWeaknesses([stat('a', 1)], 3).weaknesses).toEqual([]);
  });
});

describe('activity', () => {
  it('heatLevel buckets counts', () => {
    expect([0, 1, 4, 5, 14, 15, 29, 30, 500].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('localDateKey pads', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('builds Monday-first weeks ending with the current week', () => {
    const today = new Date(2026, 10, 11, 9); // Wednesday 11 Nov 2026
    const grid = activityGrid([at(2026, 11, 11), at(2026, 11, 11, 20), at(2026, 11, 9), at(2026, 11, 2)], today, 3);
    expect(grid).toHaveLength(3);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0][0]?.date).toBe('2026-10-26');
    expect(grid[1][0]).toEqual({ date: '2026-11-02', count: 1, level: 1 });
    expect(grid[2][0]).toEqual({ date: '2026-11-09', count: 1, level: 1 });
    expect(grid[2][2]).toEqual({ date: '2026-11-11', count: 2, level: 1 });
    expect(grid[2].slice(3)).toEqual([null, null, null, null]);
  });
  it('activeDayStreak counts back from today or yesterday', () => {
    const today = new Date(2026, 10, 11, 9);
    expect(activeDayStreak([at(2026, 11, 11), at(2026, 11, 10), at(2026, 11, 9), at(2026, 11, 7)], today)).toBe(3);
    expect(activeDayStreak([at(2026, 11, 10), at(2026, 11, 9)], today)).toBe(2);
    expect(activeDayStreak([at(2026, 11, 8)], today)).toBe(0);
    expect(activeDayStreak([], today)).toBe(0);
  });
});

describe('totals / rush / battle', () => {
  it('totals', () => {
    expect(totals([])).toEqual({ attempted: 0, solved: 0, accuracy: null, timeMs: 0 });
    expect(totals([{ solved: true, timeMs: 1000 }, { solved: false, timeMs: 3000 }])).toEqual({ attempted: 2, solved: 1, accuracy: 0.5, timeMs: 4000 });
  });
  it('rushBests per mode', () => {
    const b = rushBests([
      { mode: '3min', score: 12, bestCombo: 5, highestRating: 1300 },
      { mode: '3min', score: 18, bestCombo: 4, highestRating: 1500 },
      { mode: 'survival', score: 30, bestCombo: 22, highestRating: 1900 },
    ]);
    expect(b['3min']).toEqual({ best: 18, runs: 2, bestCombo: 5, highestRating: 1500 });
    expect(b['5min']).toEqual({ best: 0, runs: 0, bestCombo: 0, highestRating: 0 });
    expect(b.survival.best).toBe(30);
  });
  it('battleSummary', () => {
    expect(battleSummary([])).toEqual({ played: 0, wins: 0, losses: 0, draws: 0, winRate: null, peak: null });
    expect(battleSummary([{ result: 'win', ratingAfter: 1216 }, { result: 'loss', ratingAfter: 1200 }, { result: 'draw', ratingAfter: 1201 }, { result: 'win', ratingAfter: 1230 }]))
      .toEqual({ played: 4, wins: 2, losses: 1, draws: 1, winRate: 0.5, peak: 1230 });
  });
});

describe('chartGeometry', () => {
  it('is empty for no data', () => {
    expect(chartGeometry([], 300, 100, 10)).toEqual({ line: '', area: '', xy: [], min: 0, max: 0 });
  });
  it('spreads points across the padded box with higher values higher up', () => {
    const g = chartGeometry([1200, 1300, 1250], 320, 120, 10);
    expect(g.min).toBe(1150);
    expect(g.max).toBe(1350);
    expect(g.xy[0].x).toBe(10);
    expect(g.xy[2].x).toBe(310);
    expect(g.xy[1].y).toBeLessThan(g.xy[0].y);
    expect(g.line.startsWith('M10 ')).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
  });
  it('centres a single point', () => {
    expect(chartGeometry([1500], 300, 100, 10).xy[0].x).toBe(150);
  });
});

describe('formatDuration', () => {
  it('formats', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(12 * 60_000)).toBe('12m');
    expect(formatDuration(125 * 60_000)).toBe('2h 05m');
  });
});
