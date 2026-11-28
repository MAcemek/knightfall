import { DURATION_OPTIONS, LEVEL_OPTIONS, SERIES_OPTIONS, type FriendPrefs } from './friendSettings.ts';

/** "3 min · Normal · Best of 1": the collapsed view of the battle settings. The series part is left out when it does not apply. */
export function settingsSummary(prefs: FriendPrefs, withSeries: boolean): string {
  const time = DURATION_OPTIONS.find((o) => o.id === String(prefs.settings.durationMs))?.label ?? `${prefs.settings.durationMs / 60_000} min`;
  const level = LEVEL_OPTIONS.find((o) => o.id === prefs.settings.level)?.label ?? prefs.settings.level;
  const parts: string[] = [time, level];
  if (withSeries) parts.push(SERIES_OPTIONS.find((o) => o.id === String(prefs.series))?.label ?? 'Best of 1');
  return parts.join(' · ');
}
