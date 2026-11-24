import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Attempt, type WoodSet } from '../../shared/db.ts';
import { getAnalysisPrefs } from '../../shared/analysis/index.ts';
import { isDateKey, localDateKey } from '../../shared/localDate.ts';
import { readBlunderTotals } from '../blundercheck/blunderStore.ts';
import { dayCount } from '../blundercheck/blunderLogic.ts';
import { activeSet, readSetAttempts } from '../woodpecker/woodStore.ts';
import { isUsableSet } from '../woodpecker/woodLogic.ts';
import type { CoachPlan } from './planLogic.ts';
import { readPlan } from './planStore.ts';
import { putDay } from './stopStore.ts';
import { sanitizeNotes } from './stopRules.ts';
import {
  autoState, cleanTicks, countRapidToday, dayBounds, summary, todayTasks, toggleId, type AutoState, type AutoId, type DaySummary, type Task,
} from './todayLogic.ts';

/** Everything the Coach page and the Home strip show about today, read live from the local database. */

export interface TodayData {
  /** Local date the data is for, YYYY-MM-DD. */
  today: string;
  plan: CoachPlan | null;
  tasks: Task[];
  auto: Record<AutoId, AutoState>;
  /** Manual tasks ticked today. */
  ticks: string[];
  summary: DaySummary;
}

/** The local date, re-read every 30 seconds and when the page becomes visible again, so a page left open over midnight moves on. */
export function useLocalToday(): string {
  const [today, setToday] = useState(() => localDateKey(new Date()));
  useEffect(() => {
    const tick = () => setToday(localDateKey(new Date()));
    const timer = window.setInterval(tick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return today;
}

/** Reads the day's facts. Only reads, so it is safe inside a live query. Cheap: every query is bounded by the day or by one set. */
export async function readToday(today: string, now = Date.now()): Promise<TodayData> {
  const { start, end } = dayBounds(today);
  // The day being judged may be a moment ahead of the clock (the minute timer): keep `now` inside it.
  const at = now >= start && now < end ? now : start + 43_200_000;
  const [plan, prefs, active, totals, dayRow, attemptsToday, rushToday, games, reviews] = await Promise.all([
    readPlan(),
    getAnalysisPrefs(),
    activeSet(),
    readBlunderTotals(),
    db.coachDays.get(today),
    db.attempts.where('at').between(start, end, true, false).filter((a) => a.mode === 'woodpecker').toArray(),
    db.rushRuns.where('at').between(start, end, true, false).count(),
    db.games.where('playedAt').between(start, end, true, false).toArray(),
    db.selfReviews.where('at').between(start, end, true, false).toArray(),
  ]);
  const woodSetAttempts: Attempt[] = active ? await readSetAttempts(active.id) : [];
  const setIds = [...new Set(attemptsToday.map((a) => a.setId).filter((id): id is string => !!id))];
  const touched = (await db.woodSets.bulkGet(setIds)).filter((s): s is WoodSet => isUsableSet(s));
  const woodFinishedToday = touched.some((s) => s.cycles.some((c) => c.finishedAt !== null && c.finishedAt >= start && c.finishedAt < end));
  const anyWoodSet = !!active || touched.length > 0 || (await db.woodSets.count()) > 0;
  const tasks = todayTasks(today);
  const auto = autoState({
    now: at,
    woodSet: active,
    woodSetAttempts,
    anyWoodSet,
    woodMsToday: attemptsToday.reduce((s, a) => s + (Number.isFinite(a.timeMs) && a.timeMs > 0 ? a.timeMs : 0), 0),
    woodFinishedToday,
    rushToday,
    checkToday: dayCount(totals, today),
    rapidToday: countRapidToday(games, prefs, today),
    reviewsToday: reviews.filter((r) => !r.skipped).length,
  });
  const ticks = cleanTicks(dayRow?.ticks);
  return { today, plan, tasks, auto, ticks, summary: summary(tasks, auto, ticks) };
}

/** Live data for today. Undefined while loading. Moves on to the next day by itself. */
export function useToday(): TodayData | undefined {
  const today = useLocalToday();
  return useLiveQuery(() => readToday(today), [today]);
}

/** Ticks or unticks a manual task on `date`. The read and the write share one transaction. */
export async function toggleTick(date: string, id: string): Promise<void> {
  if (!isDateKey(date)) return;
  await db.transaction('rw', db.coachDays, async () => {
    const row = await db.coachDays.get(date);
    await putDay(date, toggleId(cleanTicks(row?.ticks), id), sanitizeNotes(row?.blitz));
  });
}
