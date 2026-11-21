import { describe, expect, it } from 'vitest';
import { challengeExtras, DEFAULT_FRIEND_PREFS, describeSettings, parsePrefs } from './friendSettings.ts';

describe('parsePrefs', () => {
  it('defaults on junk or missing input', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_FRIEND_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_FRIEND_PREFS);
    expect(parsePrefs(JSON.stringify({ settings: { durationMs: 7, level: 'x' }, series: 5 }))).toEqual(DEFAULT_FRIEND_PREFS);
  });
  it('keeps valid values', () => {
    const raw = JSON.stringify({ settings: { durationMs: 60_000, level: 'harder' }, series: 3 });
    expect(parsePrefs(raw)).toEqual({ settings: { durationMs: 60_000, level: 'harder' }, series: 3 });
  });
});

describe('describeSettings', () => {
  it('is null for a plain challenge', () => expect(describeSettings()).toBeNull());
  it('words the options', () => {
    expect(describeSettings({ durationMs: 60_000, level: 'harder' }, 3)).toBe('1 min · Harder · Best of 3');
    expect(describeSettings({ durationMs: 300_000, level: 'easier' }, 1)).toBe('5 min · Easier');
    expect(describeSettings(undefined, 3)).toBe('3 min · Normal · Best of 3');
  });
});

describe('challengeExtras', () => {
  it('sends nothing for the defaults', () => expect(challengeExtras(DEFAULT_FRIEND_PREFS.settings, 1)).toEqual({}));
  it('sends only what differs', () => {
    expect(challengeExtras({ durationMs: 60_000, level: 'normal' }, 1)).toEqual({ settings: { durationMs: 60_000, level: 'normal' } });
    expect(challengeExtras(DEFAULT_FRIEND_PREFS.settings, 3)).toEqual({ series: 3 });
  });
});
