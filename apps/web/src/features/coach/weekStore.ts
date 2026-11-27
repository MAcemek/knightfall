import { addDays, REPORT_VERSION } from '@knightfall/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type WoodSet } from '../../shared/db.ts';
import { getAnalysisPrefs } from '../../shared/analysis/index.ts';
import { resolveSide } from '../../shared/analysis/side.ts';
import { localDateKey } from '../../shared/localDate.ts';
import { readBlunderTotals } from '../blundercheck/blunderStore.ts';
import { checkTarget } from './adaptLogic.ts';
import { readSnapshot } from './adaptStore.ts';
import { readActivity } from './stopStore.ts';
import { dayBounds } from './todayLogic.ts';
import type { WeekGame, WeekInput } from './weekLogic.ts';

/** The week's rows from the local database. Every query is bounded by the week. The counting is in weekLogic.ts. */

export type WeekData = Omit<WeekInput, 'weekFirst' | 'today' | 'plan'>;

/** Reads only, so it is safe inside a live query. The check and focus targets are the ones the Today list had on `today` (or the week's last day for a past week). */
export async function readWeek(weekFirst: string, today: string = localDateKey(new Date())): Promise<WeekData> {
  const weekLast = addDays(weekFirst, 6);
  const start = dayBounds(weekFirst).start;
  const end = dayBounds(weekLast).end;
  const [prefs, checkTotals, activity, attempts, rush, rows, selfReviews, days, ratings, themeRows] = await Promise.all([
    getAnalysisPrefs(),
    readBlunderTotals(),
    readActivity(),
    db.attempts.where('at').between(start, end, true, false).filter((a) => a.mode === 'woodpecker').toArray(),
    db.rushRuns.where('at').between(start, end, true, false).toArray(),
    db.games.where('playedAt').between(start, end, true, false).toArray(),
    db.selfReviews.where('at').between(start, end, true, false).toArray(),
    db.coachDays.where('date').between(weekFirst, weekLast, true, true).toArray(),
    db.ratingLog.where('date').between(weekFirst, weekLast, true, true).toArray(),
    db.attempts.where('at').between(start, end, true, false).filter((a) => a.mode === 'theme').toArray(),
  ]);
  const snapshot = await readSnapshot(dayBounds(today < weekLast ? today : weekLast).start, prefs);
  // Cycles finished this week, from the sets the week's attempts belong to.
  const setIds = [...new Set(attempts.map((a) => a.setId).filter((id): id is string => !!id))];
  const sets = (await db.woodSets.bulkGet(setIds)).filter((s): s is WoodSet => !!s && Array.isArray(s.cycles));
  const woodFinishedAt = sets.flatMap((s) => s.cycles.flatMap((c) => (c.finishedAt !== null && c.finishedAt >= start && c.finishedAt < end ? [c.finishedAt] : [])));

  const sided = rows.map((game) => ({ game, side: resolveSide(game, prefs) }));
  const siteRapid = sided.filter((x) => x.side !== null && x.game.source !== 'bot' && x.game.speed === 'rapid');
  const analyses = await db.analyses.bulkGet(siteRapid.map((x) => x.game.key));
  const blunders = new Map<string, number>();
  siteRapid.forEach((x, i) => {
    const report = analyses[i]?.report;
    const counts = report?.version === REPORT_VERSION ? report.counts : undefined;
    const mine = counts ? (x.side === 'w' ? counts.white : counts.black) : undefined;
    if (typeof mine?.blunder === 'number' && Number.isFinite(mine.blunder)) blunders.set(x.game.key, mine.blunder);
  });
  const games: WeekGame[] = sided.map(({ game, side }) => {
    const site = side !== null && game.source !== 'bot' && game.speed === 'rapid';
    return {
      playedAt: game.playedAt,
      source: game.source,
      ...(game.speed ? { speed: game.speed } : {}),
      side,
      blunders: blunders.get(game.key) ?? null,
      clock: site && side ? { pgn: game.pgn, side, ...(game.timeControl ? { timeControl: game.timeControl } : {}) } : null,
    };
  });
  return {
    woodAttempts: attempts.map((a) => ({ at: a.at, solved: a.solved, timeMs: a.timeMs })),
    woodFinishedAt,
    rushRuns: rush.map((r) => ({ at: r.at, score: r.score })),
    checkTotals,
    games,
    reviews: selfReviews.map((r) => ({ at: r.at, skipped: r.skipped })),
    days,
    activity,
    ratings,
    checkTarget: checkTarget(snapshot.blunderAvg, snapshot.blunderGames),
    focusTheme: snapshot.focus?.theme ?? null,
    themeAttempts: themeRows.map((a) => ({ at: a.at, ...(a.themes ? { themes: a.themes } : {}) })),
  };
}

/** Live rows of the week that starts on `weekFirst`. Undefined while loading. */
export function useWeekData(weekFirst: string): WeekData | undefined {
  return useLiveQuery(() => readWeek(weekFirst), [weekFirst]);
}
