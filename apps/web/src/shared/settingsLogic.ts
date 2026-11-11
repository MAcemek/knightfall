/** Pure settings model (no React, no IndexedDB) so it is easy to unit-test. */

export type BoardThemeId = 'tide' | 'ember' | 'dusk' | 'glacier';
export type AnimSpeed = 'normal' | 'fast' | 'off';

export interface Settings {
  /** Sound effects on/off. */
  sound: boolean;
  /** Master volume, 0..1. */
  volume: number;
  boardTheme: BoardThemeId;
  /** 'fast' shortens decorative motion, 'off' disables it. Never affects game timers. */
  animSpeed: AnimSpeed;
  /** Rank/file labels on the board. */
  showCoords: boolean;
  /** Rated puzzles: load the next puzzle automatically after a solve. */
  autoAdvance: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 1,
  boardTheme: 'tide',
  animSpeed: 'normal',
  showCoords: true,
  autoAdvance: false,
};

export interface BoardTheme {
  id: BoardThemeId;
  label: string;
  light: string;
  dark: string;
}

/** Board palettes, all original to Knightfall. 'tide' is the v1 look. */
export const BOARD_THEMES: readonly BoardTheme[] = [
  { id: 'tide', label: 'Tide', light: '#dfe6e3', dark: '#6b8f8d' },
  { id: 'ember', label: 'Ember', light: '#f3e4cf', dark: '#b8744a' },
  { id: 'dusk', label: 'Dusk', light: '#dcd8ee', dark: '#7b6fae' },
  { id: 'glacier', label: 'Glacier', light: '#e2ecf5', dark: '#5c84ad' },
];

export const ANIM_SPEEDS: readonly { id: AnimSpeed; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Fast' },
  { id: 'off', label: 'Off' },
];

export function boardTheme(id: BoardThemeId): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Coerce anything (old/corrupt stored value) into a valid Settings object. Unknown fields are dropped. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : d.volume;
  return {
    sound: typeof r.sound === 'boolean' ? r.sound : d.sound,
    volume,
    boardTheme: BOARD_THEMES.some((t) => t.id === r.boardTheme) ? (r.boardTheme as BoardThemeId) : d.boardTheme,
    animSpeed: ANIM_SPEEDS.some((s) => s.id === r.animSpeed) ? (r.animSpeed as AnimSpeed) : d.animSpeed,
    showCoords: typeof r.showCoords === 'boolean' ? r.showCoords : d.showCoords,
    autoAdvance: typeof r.autoAdvance === 'boolean' ? r.autoAdvance : d.autoAdvance,
  };
}

/** First-run settings from the v1 localStorage flags ('kf:muted', 'kf:puzzles:autoNext'). */
export function migrateLegacy(legacy: { muted: string | null; autoNext: string | null }): Settings {
  return { ...DEFAULT_SETTINGS, sound: legacy.muted !== '1', autoAdvance: legacy.autoNext === '1' };
}
