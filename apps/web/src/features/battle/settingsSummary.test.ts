import { describe, expect, it } from 'vitest';
import { DEFAULT_FRIEND_PREFS, type FriendPrefs } from './friendSettings.ts';
import { settingsSummary } from './settingsSummary.ts';

describe('settingsSummary', () => {
  it('summarises the defaults with and without the series part', () => {
    expect(settingsSummary(DEFAULT_FRIEND_PREFS, true)).toBe(`${settingsSummary(DEFAULT_FRIEND_PREFS, false)} · Best of 1`);
  });

  it('uses the option labels', () => {
    const prefs: FriendPrefs = { settings: { durationMs: 60_000, level: 'harder' }, series: 3 };
    expect(settingsSummary(prefs, true)).toBe('1 min · Harder · Best of 3');
    expect(settingsSummary(prefs, false)).toBe('1 min · Harder');
  });

  it('words every duration and level', () => {
    expect(settingsSummary({ settings: { durationMs: 300_000, level: 'easier' }, series: 1 }, false)).toBe('5 min · Easier');
    expect(settingsSummary({ settings: { durationMs: 180_000, level: 'normal' }, series: 1 }, true)).toBe('3 min · Normal · Best of 1');
  });
});
