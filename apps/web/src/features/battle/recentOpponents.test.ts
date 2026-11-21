import { describe, expect, it } from 'vitest';
import { MAX_RECENT, recordOpponentResult, removeOpponent, sanitizeRecent, upsertOpponent, type RecentOpponent } from './recentOpponents.ts';

const p = (code: string, at = 1) => ({ code, name: code, rating: 1200, at });

describe('recent opponents', () => {
  it('puts the newest first and keeps the record on a repeat', () => {
    let l: RecentOpponent[] = upsertOpponent([], p('AAA'));
    l = recordOpponentResult(l, 'AAA', 'win');
    l = upsertOpponent(l, p('BBB', 2));
    l = upsertOpponent(l, { code: 'AAA', name: 'Renamed', rating: 1300, at: 3 });
    expect(l.map((o) => o.code)).toEqual(['AAA', 'BBB']);
    expect(l[0]).toMatchObject({ name: 'Renamed', rating: 1300, lastAt: 3, w: 1, l: 0, d: 0 });
  });
  it('caps the list', () => {
    let l: RecentOpponent[] = [];
    for (let i = 0; i < MAX_RECENT + 3; i++) l = upsertOpponent(l, p(`C${i}`, i));
    expect(l).toHaveLength(MAX_RECENT);
    expect(l[0].code).toBe(`C${MAX_RECENT + 2}`);
  });
  it('counts results and ignores unknown codes', () => {
    let l = upsertOpponent([], p('AAA'));
    l = recordOpponentResult(l, 'AAA', 'loss');
    l = recordOpponentResult(l, 'AAA', 'draw');
    l = recordOpponentResult(l, 'ZZZ', 'win');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ w: 0, l: 1, d: 1 });
  });
  it('removes and sanitizes', () => {
    expect(removeOpponent(upsertOpponent([], p('AAA')), 'AAA')).toEqual([]);
    expect(sanitizeRecent('x')).toEqual([]);
    expect(sanitizeRecent([{ code: 'A', name: 'n' }, { code: 1 }, null])).toEqual([{ code: 'A', name: 'n', rating: 0, lastAt: 0, w: 0, l: 0, d: 0 }]);
  });
});
