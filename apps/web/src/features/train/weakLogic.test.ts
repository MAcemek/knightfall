import { describe, expect, it } from 'vitest';
import { MAX_WEAK_THEMES, MIN_WEAK_ATTEMPTS, themeForTurn, weakState, weakThemes } from './weakLogic.ts';

type Row = { themes: string[]; solved: boolean };
const many = (theme: string, solved: number, missed: number): Row[] => [
  ...Array.from({ length: solved }, () => ({ themes: [theme], solved: true })),
  ...Array.from({ length: missed }, () => ({ themes: [theme], solved: false })),
];

describe('weakThemes', () => {
  it('returns nothing for empty rows', () => {
    expect(weakThemes([])).toEqual([]);
  });
  it('ignores themes below the minimum attempts', () => {
    expect(weakThemes(many('fork', 0, MIN_WEAK_ATTEMPTS - 1))).toEqual([]);
  });
  it('excludes untrainable themes', () => {
    expect(weakThemes([...many('middlegame', 0, 8), ...many('fork', 3, 3)]).map((s) => s.theme)).toEqual(['fork']);
  });
  it('returns nothing when no trainable theme has a miss', () => {
    expect(weakThemes([...many('fork', 8, 0), ...many('pin', 6, 0)])).toEqual([]);
  });
  it('smooths small samples: 20/60 ranks worse than 1/5 when the player is generally strong', () => {
    const rows = [...many('fork', 1, 4), ...many('pin', 20, 40), ...many('skewer', 200, 0)];
    const out = weakThemes(rows).map((s) => s.theme);
    expect(out.indexOf('pin')).toBeLessThan(out.indexOf('fork'));
  });
  it('keeps fewer than three themes when there are fewer', () => {
    expect(weakThemes([...many('fork', 2, 3), ...many('pin', 5, 0)]).map((s) => s.theme)).toEqual(['fork']);
  });
  it('caps the list at MAX_WEAK_THEMES, worst first', () => {
    const rows = [...many('fork', 1, 9), ...many('pin', 3, 7), ...many('skewer', 5, 5), ...many('sacrifice', 8, 2), ...many('mateIn2', 9, 1)];
    const out = weakThemes(rows);
    expect(out).toHaveLength(MAX_WEAK_THEMES);
    expect(out.map((s) => s.theme)).toEqual(['fork', 'pin', 'skewer']);
  });
  it('breaks ties by more misses, then by name', () => {
    // identical smoothed accuracy cannot be built from different counts easily, so use equal counts for the name tie
    const byName = weakThemes([...many('pin', 2, 3), ...many('fork', 2, 3)]).map((s) => s.theme);
    expect(byName).toEqual(['fork', 'pin']);
    // same smoothed score, more misses first: both are 50%, overall 50%, so smoothed is 0.5 for each
    const byMisses = weakThemes([...many('pin', 3, 3), ...many('fork', 5, 5)]).map((s) => s.theme);
    expect(byMisses).toEqual(['fork', 'pin']);
  });
});

describe('themeForTurn', () => {
  it('rotates one theme per puzzle', () => {
    const t = ['fork', 'pin', 'skewer'];
    expect([0, 1, 2, 3, 4].map((i) => themeForTurn(t, i))).toEqual(['fork', 'pin', 'skewer', 'fork', 'pin']);
  });
  it('works with one theme', () => {
    expect(themeForTurn(['fork'], 7)).toBe('fork');
  });
});

describe('weakState', () => {
  it('is loading while rows are undefined', () => {
    expect(weakState(undefined)).toBe('loading');
  });
  it('needs data with no rows or few attempts', () => {
    expect(weakState([])).toBe('need-data');
    expect(weakState(many('fork', 1, 3))).toBe('need-data');
    expect(weakState(many('middlegame', 2, 8))).toBe('need-data');
  });
  it('is none when nothing was missed', () => {
    expect(weakState(many('fork', 6, 0))).toBe('none');
  });
  it('is ready when a tried theme has misses', () => {
    expect(weakState(many('fork', 3, 3))).toBe('ready');
  });
});
