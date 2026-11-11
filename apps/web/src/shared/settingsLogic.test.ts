import { describe, expect, it } from 'vitest';
import { BOARD_THEMES, boardTheme, DEFAULT_SETTINGS, migrateLegacy, sanitizeSettings } from './settingsLogic.ts';

describe('sanitizeSettings', () => {
  it('returns defaults for junk', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps valid fields and drops invalid ones', () => {
    const s = sanitizeSettings({ sound: false, volume: 0.4, boardTheme: 'dusk', animSpeed: 'off', showCoords: false, autoAdvance: true, extra: 1 });
    expect(s).toEqual({ sound: false, volume: 0.4, boardTheme: 'dusk', animSpeed: 'off', showCoords: false, autoAdvance: true });
    expect(sanitizeSettings({ boardTheme: 'green', animSpeed: 'slow', sound: 'yes' })).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps volume to 0..1', () => {
    expect(sanitizeSettings({ volume: 7 }).volume).toBe(1);
    expect(sanitizeSettings({ volume: -2 }).volume).toBe(0);
    expect(sanitizeSettings({ volume: Number.NaN }).volume).toBe(DEFAULT_SETTINGS.volume);
  });
});

describe('migrateLegacy', () => {
  it('maps the v1 localStorage flags', () => {
    expect(migrateLegacy({ muted: '1', autoNext: '1' })).toMatchObject({ sound: false, autoAdvance: true });
    expect(migrateLegacy({ muted: null, autoNext: null })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('boardTheme', () => {
  it('finds a palette and falls back to the first', () => {
    expect(boardTheme('glacier').label).toBe('Glacier');
    expect(boardTheme('nope' as never)).toBe(BOARD_THEMES[0]);
    expect(new Set(BOARD_THEMES.map((t) => t.id)).size).toBe(BOARD_THEMES.length);
  });
});
