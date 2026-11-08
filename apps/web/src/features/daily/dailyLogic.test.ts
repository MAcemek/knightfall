import { describe, expect, it } from 'vitest';
import {
  addMonths, bestStreakOf, dayKind, formatHMS, isDateKey, mergeDaily, monthGrid, msToNextUtcMidnight, shareText, streakOf, type DailyEntry,
} from './dailyLogic.ts';

const base = { puzzleId: 'p1', at: 1 };
const rec = (date: string, extra: Partial<DailyEntry> = {}): DailyEntry => ({ date, solved: true, clean: true, ...base, ...extra });

describe('mergeDaily', () => {
  const o = { date: '2026-11-08', puzzleId: 'p1', at: 5 };
  it('creates a same-day record', () => {
    expect(mergeDaily(undefined, { ...o, solved: true, clean: true, late: false })).toMatchObject({ solved: true, clean: true });
    expect(mergeDaily(undefined, { ...o, solved: false, clean: false, late: false })).toMatchObject({ solved: false, clean: false });
  });
  it('never overwrites a solve or writes a fail over anything', () => {
    expect(mergeDaily(rec('2026-11-08'), { ...o, solved: false, clean: false, late: false })).toBeNull();
    expect(mergeDaily(rec('2026-11-08', { solved: false, clean: false }), { ...o, solved: false, clean: false, late: false })).toBeNull();
    expect(mergeDaily(rec('2026-11-08'), { ...o, solved: true, clean: true, late: true })).toBeNull();
  });
  it('upgrades a same-day fail to a (not clean) solve', () => {
    expect(mergeDaily(rec('2026-11-08', { solved: false, clean: false }), { ...o, solved: true, clean: true, late: false })).toMatchObject({ solved: true, clean: false });
  });
  it('records late solves without counting them as solved', () => {
    const r = mergeDaily(undefined, { ...o, solved: true, clean: true, late: true });
    expect(r).toMatchObject({ solved: false, clean: false, solvedLate: true, playedLate: true });
    expect(mergeDaily(rec('2026-11-08', { solved: false, clean: false }), { ...o, solved: true, clean: true, late: true })).toMatchObject({ solved: false, solvedLate: true });
  });
});

describe('streaks', () => {
  it('ignores late solves', () => {
    const rs = [rec('2026-11-08'), rec('2026-11-07', { solved: false, solvedLate: true }), rec('2026-11-06')];
    expect(streakOf(rs, '2026-11-08')).toBe(1);
    expect(bestStreakOf(rs)).toBe(1);
  });
  it('counts runs ending yesterday', () => {
    const rs = [rec('2026-11-07'), rec('2026-11-06'), rec('2026-11-05'), rec('2026-10-01')];
    expect(streakOf(rs, '2026-11-08')).toBe(3);
    expect(bestStreakOf(rs)).toBe(3);
  });
});

describe('calendar helpers', () => {
  it('builds a Sunday-first grid', () => {
    const g = monthGrid('2026-11'); // Nov 1 2026 is a Sunday
    expect(g[0]).toBe('2026-11-01');
    expect(g.filter(Boolean)).toHaveLength(30);
    expect(g.length % 7).toBe(0);
    const feb = monthGrid('2026-02'); // Feb 1 2026 is a Sunday too; 28 days
    expect(feb.filter(Boolean)).toHaveLength(28);
  });
  it('moves months across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });
  it('classifies days', () => {
    expect(dayKind('2026-11-09', '2026-11-08', undefined, null)).toBe('future');
    expect(dayKind('2026-11-08', '2026-11-08', undefined, null)).toBe('pending');
    expect(dayKind('2026-11-01', '2026-11-08', undefined, null)).toBe('open');
    expect(dayKind('2026-11-03', '2026-11-08', undefined, '2026-11-02')).toBe('missed');
    expect(dayKind('2026-11-03', '2026-11-08', rec('2026-11-03', { solved: false, clean: false }), '2026-11-02')).toBe('failed');
    expect(dayKind('2026-11-03', '2026-11-08', rec('2026-11-03', { clean: false }), null)).toBe('solved');
    expect(dayKind('2026-11-03', '2026-11-08', rec('2026-11-03', { solved: false, solvedLate: true }), null)).toBe('late');
  });
  it('validates date keys', () => {
    expect(isDateKey('2026-11-08')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('nope')).toBe(false);
  });
});

describe('time + share', () => {
  it('counts down to UTC midnight', () => {
    const now = Date.UTC(2026, 10, 8, 23, 59, 30);
    expect(msToNextUtcMidnight(now)).toBe(30_000);
    expect(formatHMS(3_723_000)).toBe('01:02:03');
  });
  it('builds spoiler-free share text', () => {
    expect(shareText({ date: '2026-11-08', solved: true, late: false, moves: 3, streak: 5, clean: false })).toBe('Knightfall Daily 2026-11-08 ✅ 3 moves · streak 5🔥');
    expect(shareText({ date: '2026-11-07', solved: true, late: true, moves: 1, streak: 5, clean: true })).toBe('Knightfall Daily 2026-11-07 ✅ 1 move · played late');
  });
});
