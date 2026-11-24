import { isTrainableTheme } from '../../shared/themes.ts';
import { themeAccuracy } from '../stats/statsLogic.ts';
import type { ThemeStat } from '../stats/statsLogic.ts';

/** A theme counts once the player has tried at least this many of its puzzles. */
export const MIN_WEAK_ATTEMPTS = 5;
/** The weakest themes a session draws from. */
export const MAX_WEAK_THEMES = 3;

type Row = { themes: readonly string[]; solved: boolean };

/** Trainable themes tried at least MIN_WEAK_ATTEMPTS times, before any miss filtering. */
function triedThemes(rows: readonly Row[]): ThemeStat[] {
  return themeAccuracy(rows, MIN_WEAK_ATTEMPTS).filter((s) => isTrainableTheme(s.theme));
}

/** The themes the player misses most, worst first. Small samples are pulled toward the player's overall accuracy. */
export function weakThemes(rows: readonly Row[]): ThemeStat[] {
  const overall = rows.length ? rows.filter((r) => r.solved).length / rows.length : 0;
  const score = (s: ThemeStat) => (s.solved + 5 * overall) / (s.attempts + 5);
  return triedThemes(rows)
    .filter((s) => s.solved < s.attempts)
    .sort((a, b) => score(a) - score(b) || b.attempts - b.solved - (a.attempts - a.solved) || a.theme.localeCompare(b.theme))
    .slice(0, MAX_WEAK_THEMES);
}

/** One theme per puzzle, in turn, so a rare theme is not drowned out by a common one. */
export function themeForTurn(themes: readonly string[], index: number): string {
  return themes[index % themes.length] as string;
}

export type WeakState = 'loading' | 'need-data' | 'none' | 'ready';

export function weakState(rows: readonly Row[] | undefined): WeakState {
  if (!rows) return 'loading';
  if (triedThemes(rows).length === 0) return 'need-data';
  return weakThemes(rows).length === 0 ? 'none' : 'ready';
}
