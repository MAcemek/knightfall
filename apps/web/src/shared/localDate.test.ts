import { describe, expect, it } from 'vitest';
import { dayKeyOf, daysBetween, isDateKey, localDateKey, weekdayOf, weekStart } from './localDate.ts';

describe('local dates', () => {
  it('pads and uses the local day, not the UTC one', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayKeyOf(new Date(2026, 0, 5, 0, 1).getTime())).toBe('2026-01-05');
  });

  it('weekday: Monday is 0, Sunday is 6', () => {
    expect(weekdayOf('2026-11-23')).toBe(0); // Monday
    expect(weekdayOf('2026-11-24')).toBe(1);
    expect(weekdayOf('2026-11-29')).toBe(6); // Sunday
  });

  it('daysBetween counts whole days, across month and daylight-saving changes', () => {
    expect(daysBetween('2026-11-24', '2026-11-24')).toBe(0);
    expect(daysBetween('2026-10-20', '2026-11-03')).toBe(14);
    expect(daysBetween('2026-03-01', '2026-02-27')).toBe(-2);
  });

  it('weekStart is the Monday', () => {
    expect(weekStart('2026-11-24')).toBe('2026-11-23');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekStart('2026-12-06')).toBe('2026-11-30');
  });

  it('isDateKey rejects impossible dates', () => {
    expect(isDateKey('2026-11-24')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('24.11.2026')).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });
});
