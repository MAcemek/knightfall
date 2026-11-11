/** Puzzle themes (Lichess tags): labels, the curated training list, and pure filtering helpers. */

/** "advancedPawn" → "Advanced pawn", "mateIn2" → "Mate in 2". */
export function themeLabel(theme: string): string {
  const words = theme
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Themes that only describe length/phase/source and say little about the tactic itself. */
export const LOW_PRIORITY_THEMES: ReadonlySet<string> = new Set([
  'short', 'long', 'veryLong', 'oneMove', 'middlegame', 'endgame', 'opening', 'master', 'masterVsMaster', 'superGM', 'crushing', 'advantage', 'equality',
]);

/** Sort themes so tactical motifs (fork, pin, mate…) come before length/phase tags. */
export function sortThemes(themes: string[]): string[] {
  return [...themes].sort((a, b) => Number(LOW_PRIORITY_THEMES.has(a)) - Number(LOW_PRIORITY_THEMES.has(b)));
}

export interface ThemeGroup {
  id: 'tactics' | 'mates' | 'attack' | 'endgames';
  label: string;
  themes: readonly string[];
}

/**
 * Themes offered for theme training. Curated: every key has at least ~200 puzzles in the bundled set,
 * so a session never runs dry. Keys are exact Lichess theme tags as stored in the puzzle buckets.
 */
export const THEME_GROUPS: readonly ThemeGroup[] = [
  {
    id: 'tactics',
    label: 'Tactics',
    themes: ['fork', 'pin', 'skewer', 'discoveredAttack', 'deflection', 'attraction', 'sacrifice', 'hangingPiece', 'trappedPiece', 'intermezzo', 'clearance', 'quietMove', 'defensiveMove', 'capturingDefender'],
  },
  { id: 'mates', label: 'Checkmates', themes: ['mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'backRankMate', 'doubleCheck', 'discoveredCheck'] },
  { id: 'attack', label: 'Attack & pawns', themes: ['kingsideAttack', 'queensideAttack', 'exposedKing', 'advancedPawn', 'promotion', 'zugzwang'] },
  { id: 'endgames', label: 'Endgames', themes: ['rookEndgame', 'pawnEndgame', 'bishopEndgame', 'knightEndgame', 'queenEndgame'] },
];

export const TRAINABLE_THEMES: readonly string[] = THEME_GROUPS.flatMap((g) => g.themes);

export function isTrainableTheme(theme: string): boolean {
  return TRAINABLE_THEMES.includes(theme);
}

/** True when the puzzle has at least one of `wanted`. An empty `wanted` matches everything. */
export function matchesThemes(puzzleThemes: readonly string[], wanted: readonly string[]): boolean {
  if (!wanted.length) return true;
  return wanted.some((t) => puzzleThemes.includes(t));
}

/**
 * Buckets to search for a themed puzzle, nearest to `start` first:
 * start, start−size, start+size, start−2·size, … clipped to [min, max]. Every bucket appears once.
 */
export function bucketSearchOrder(start: number, min: number, max: number, size: number): number[] {
  const s = Math.max(min, Math.min(max, start));
  const out: number[] = [s];
  const steps = Math.ceil((max - min) / size);
  for (let d = 1; d <= steps; d++) {
    const lo = s - d * size;
    const hi = s + d * size;
    if (lo >= min) out.push(lo);
    if (hi <= max) out.push(hi);
  }
  return out;
}
