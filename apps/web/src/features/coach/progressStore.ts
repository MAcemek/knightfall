import { REPORT_VERSION } from '@knightfall/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CoachSpeed, type StoredGame, type WoodSet } from '../../shared/db.ts';
import { getAnalysisPrefs } from '../../shared/analysis/index.ts';
import { resolveSide } from '../../shared/analysis/side.ts';
import { isUsableSet, type CycleSummary } from '../woodpecker/woodLogic.ts';
import { readSetAttempts } from '../woodpecker/woodStore.ts';
import { COACH_SPEEDS } from './planLogic.ts';
import { readPlan } from './planStore.ts';
import {
  blundersPerGame, clockShare, newestSet, ratingSeries, woodTimes, type BlunderRow, type BlunderStat, type ClockRow, type ClockStat, type RatingPoint,
} from './progressLogic.ts';

/** Progress numbers read from the local database. The rules are in progressLogic.ts. */

export interface ProgressData {
  ratings: Record<CoachSpeed, RatingPoint[]>;
  blunders: BlunderStat;
  clocks: ClockStat;
  wood: { set: WoodSet | null; cycles: CycleSummary[] };
}

/** How many games with a stored analysis are enough for the blunder numbers (two groups of ten). */
const BLUNDER_GAMES = 20;
const BATCH = 20;

/** Rapid games played on a site, not against the built-in bot, with a known side, newest first. With `before`, only games played before that moment. */
async function rapidGames(before?: number): Promise<{ game: StoredGame; side: 'w' | 'b' }[]> {
  const users = await getAnalysisPrefs();
  const rows = await db.games
    .orderBy('playedAt')
    .reverse()
    .filter((g) => g.speed === 'rapid' && (g.source === 'lichess' || g.source === 'chesscom') && (before === undefined || g.playedAt < before))
    .toArray();
  return rows.flatMap((game) => {
    const side = resolveSide(game, users);
    return side ? [{ game, side }] : [];
  });
}

/** Blunders of the player's own side in the newest analysed rapid games. Reads reports in small batches and stops at 20 games. */
async function blunderRows(games: readonly { game: StoredGame; side: 'w' | 'b' }[]): Promise<BlunderRow[]> {
  const out: BlunderRow[] = [];
  for (let i = 0; i < games.length && out.length < BLUNDER_GAMES; i += BATCH) {
    const batch = games.slice(i, i + BATCH);
    const analyses = await db.analyses.bulkGet(batch.map((b) => b.game.key));
    batch.forEach((b, j) => {
      const report = analyses[j]?.report;
      const counts = report?.version === REPORT_VERSION ? report.counts : undefined;
      const mine = counts ? (b.side === 'w' ? counts.white : counts.black) : undefined;
      const blunders = mine?.blunder;
      if (typeof blunders === 'number' && Number.isFinite(blunders) && out.length < BLUNDER_GAMES) out.push({ playedAt: b.game.playedAt, blunders });
    });
  }
  return out;
}

/** `before` limits the blunder and clock numbers to games played before that moment (the Today list uses the start of the day). */
export async function readProgress(before?: number): Promise<ProgressData> {
  const [log, games, sets, plan] = await Promise.all([db.ratingLog.toArray(), rapidGames(before), db.woodSets.orderBy('createdAt').reverse().filter(isUsableSet).limit(1).toArray(), readPlan()]);
  const ratings = Object.fromEntries(COACH_SPEEDS.map((s) => [s, ratingSeries(log, s, plan?.username)])) as Record<CoachSpeed, RatingPoint[]>;
  const clockRows: ClockRow[] = games.slice(0, 15).map(({ game, side }) => ({ pgn: game.pgn, side, ...(game.timeControl ? { timeControl: game.timeControl } : {}) }));
  const set = newestSet(sets);
  const cycles = set ? woodTimes(set, await readSetAttempts(set.id)) : [];
  return { ratings, blunders: blundersPerGame(await blunderRows(games)), clocks: clockShare(clockRows), wood: { set, cycles } };
}

/** Live progress. Undefined while loading. */
export function useProgress(): ProgressData | undefined {
  return useLiveQuery(() => readProgress(), []);
}
