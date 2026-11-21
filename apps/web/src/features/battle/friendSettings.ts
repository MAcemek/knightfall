import { DEFAULT_BATTLE_SETTINGS, type BattleLevel, type BattleSettings } from '@knightfall/core';

/** Friend battle options the challenger picks (pure): choices, remembered prefs, and how to word them. */

export type Series = 1 | 3;
export interface FriendPrefs {
  settings: BattleSettings;
  series: Series;
}

export const DEFAULT_FRIEND_PREFS: FriendPrefs = { settings: DEFAULT_BATTLE_SETTINGS, series: 1 };

export const DURATION_OPTIONS = [
  { id: '60000', label: '1 min' },
  { id: '180000', label: '3 min' },
  { id: '300000', label: '5 min' },
] as const;
export const LEVEL_OPTIONS = [
  { id: 'easier', label: 'Easier' },
  { id: 'normal', label: 'Normal' },
  { id: 'harder', label: 'Harder' },
] as const;
export const SERIES_OPTIONS = [
  { id: '1', label: 'Best of 1' },
  { id: '3', label: 'Best of 3' },
] as const;

const LEVEL_LABEL: Record<BattleLevel, string> = { easier: 'Easier', normal: 'Normal', harder: 'Harder' };

function isDuration(v: unknown): v is BattleSettings['durationMs'] {
  return v === 60_000 || v === 180_000 || v === 300_000;
}
function isLevel(v: unknown): v is BattleLevel {
  return v === 'easier' || v === 'normal' || v === 'harder';
}

/** Read stored prefs; anything missing or unknown falls back to the defaults. */
export function parsePrefs(raw: string | null): FriendPrefs {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return {
      settings: {
        durationMs: isDuration(v?.settings?.durationMs) ? v.settings.durationMs : DEFAULT_BATTLE_SETTINGS.durationMs,
        level: isLevel(v?.settings?.level) ? v.settings.level : DEFAULT_BATTLE_SETTINGS.level,
      },
      series: v?.series === 3 ? 3 : 1,
    };
  } catch {
    return DEFAULT_FRIEND_PREFS;
  }
}

/** "1 min · Harder · Best of 3". Null when nothing was chosen (a plain challenge). */
export function describeSettings(settings?: BattleSettings, series?: Series): string | null {
  if (!settings && !series) return null;
  const s = settings ?? DEFAULT_BATTLE_SETTINGS;
  const parts = [`${s.durationMs / 60_000} min`, LEVEL_LABEL[s.level]];
  if (series === 3) parts.push('Best of 3');
  return parts.join(' · ');
}

/** The challenge fields to send: only what differs from the defaults, so plain challenges stay as they were. */
export function challengeExtras(settings: BattleSettings, series: Series): { settings?: BattleSettings; series?: 3 } {
  const isDefault = settings.durationMs === DEFAULT_BATTLE_SETTINGS.durationMs && settings.level === DEFAULT_BATTLE_SETTINGS.level;
  return { ...(isDefault ? {} : { settings }), ...(series === 3 ? { series: 3 as const } : {}) };
}
