import { REPORT_VERSION } from '@knightfall/core';
import { db, type StoredGame } from '../../shared/db.ts';
import { buildInsights } from '../analysis/insights/insightsLogic.ts';
import { clockNote, pickFocus, type Focus, type MotifCount, type ThemeRow } from './adaptLogic.ts';
import { readProgress } from './progressStore.ts';

/* ---------- what the list adapts to ---------- */

/** What the player has done before today. Slow to build, so it is cached until the stored data changes. */
export interface Snapshot {
  focus: Focus | null;
  blunderAvg: number | null;
  blunderGames: number;
  clock: string | null;
}

export const EMPTY_SNAPSHOT: Snapshot = { focus: null, blunderAvg: null, blunderGames: 0, clock: null };
const THEME_MODES: ReadonlySet<string> = new Set(['rated', 'rush', 'theme', 'review']);
const THEME_ROWS = 300;
const MOTIF_GAMES = 30;

let cached: { sig: string; value: Snapshot } | null = null;

async function buildSnapshot(start: number, users: { lichessUser: string; chesscomUser: string }): Promise<Snapshot> {
  // Only what happened before today: the focus must not move while the player works on it.
  const attempts = await db.attempts
    .where('at')
    .below(start)
    .reverse()
    .filter((a) => THEME_MODES.has(a.mode) && Array.isArray(a.themes) && a.themes.length > 0)
    .limit(THEME_ROWS)
    .toArray();
  const rows: ThemeRow[] = attempts.map((a) => ({ themes: a.themes ?? [], solved: a.solved }));
  const analyses = await db.analyses.where('analysedAt').below(start).reverse().limit(MOTIF_GAMES).toArray();
  const games = await db.games.bulkGet(analyses.map((a) => a.gameKey));
  const inputs = analyses.flatMap((a, i) => {
    const game = games[i];
    return game ? [{ game: game as StoredGame, report: a.report }] : [];
  });
  const insights = buildInsights(inputs, users, REPORT_VERSION);
  const motifs: MotifCount[] = insights.motifs.map((m) => ({ label: m.label, theme: m.theme, count: m.count, games: m.games }));
  const progress = await readProgress(start);
  return {
    focus: pickFocus(rows, motifs, insights.games),
    blunderAvg: progress.blunders.last,
    blunderGames: progress.blunders.games.last,
    clock: clockNote(progress.clocks),
  };
}

export async function readSnapshot(start: number, users: { lichessUser: string; chesscomUser: string }): Promise<Snapshot> {
  const [before, games, analyses, last] = await Promise.all([
    db.attempts.where('at').below(start).count(),
    db.games.count(),
    db.analyses.count(),
    db.analyses.orderBy('analysedAt').last(),
  ]);
  const sig = [start, before, games, analyses, last?.analysedAt ?? 0, users.lichessUser, users.chesscomUser].join('|');
  if (cached?.sig === sig) return cached.value;
  let value = EMPTY_SNAPSHOT;
  try {
    value = await buildSnapshot(start, users);
  } catch {
    // Damaged rows must not take the whole Today page down: fall back to the plain list.
  }
  cached = { sig, value };
  return value;
}
