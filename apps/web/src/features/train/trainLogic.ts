import { isTrainableTheme } from '../../shared/themes.ts';

/** Pure helpers for the Train pages (no React, no IndexedDB). */

/** At most this many themes can be combined in one session. */
export const MAX_THEMES = 3;

export type Difficulty = 'easier' | 'normal' | 'harder';

export const DIFFICULTIES: readonly { id: Difficulty; label: string; offset: number }[] = [
  { id: 'easier', label: 'Easier', offset: -200 },
  { id: 'normal', label: 'My level', offset: 0 },
  { id: 'harder', label: 'Harder', offset: 200 },
];

export function parseDifficulty(raw: string | null | undefined): Difficulty {
  return raw === 'easier' || raw === 'harder' ? raw : 'normal';
}

export function difficultyOffset(d: Difficulty): number {
  return DIFFICULTIES.find((x) => x.id === d)?.offset ?? 0;
}

/** "fork+pin" (route param) → valid, de-duplicated theme keys, at most MAX_THEMES. */
export function parseThemeParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split('+')) {
    if (isTrainableTheme(part) && !out.includes(part)) out.push(part);
    if (out.length === MAX_THEMES) break;
  }
  return out;
}

export function themeParam(themes: readonly string[]): string {
  return themes.join('+');
}

/** Toggle a theme in the picker; adding beyond MAX_THEMES drops the oldest pick. */
export function toggleTheme(selected: readonly string[], theme: string): string[] {
  if (selected.includes(theme)) return selected.filter((t) => t !== theme);
  return [...selected, theme].slice(-MAX_THEMES);
}

/** Target rating for a theme session: the player's rating shifted by the difficulty, kept inside the puzzle set. */
export function trainTargetRating(playerRating: number, d: Difficulty): number {
  return Math.max(400, Math.min(2900, Math.round(playerRating + difficultyOffset(d))));
}

export interface SessionTally {
  attempted: number;
  solved: number;
  /** Current run of first-try solves. */
  streak: number;
  bestStreak: number;
}

export const EMPTY_TALLY: SessionTally = { attempted: 0, solved: 0, streak: 0, bestStreak: 0 };

export function tally(prev: SessionTally, solved: boolean): SessionTally {
  const streak = solved ? prev.streak + 1 : 0;
  return { attempted: prev.attempted + 1, solved: prev.solved + (solved ? 1 : 0), streak, bestStreak: Math.max(prev.bestStreak, streak) };
}

/** "83%" or "–" when nothing was attempted. */
export function tallyAccuracy(t: SessionTally): string {
  return t.attempted ? `${Math.round((t.solved / t.attempted) * 100)}%` : '–';
}
