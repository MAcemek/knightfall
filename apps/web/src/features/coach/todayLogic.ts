import type { Attempt, StoredGame, WoodSet } from '../../shared/db.ts';
import { resolveSide, type KnownUsers } from '../../shared/analysis/side.ts';
import { addDays } from '@knightfall/core';
import { dayKeyOf, isDateKey, weekdayOf } from '../../shared/localDate.ts';
import { currentCycle, pace } from '../woodpecker/woodLogic.ts';

/** What to do today: the task list of the day and how much of it is done. No React, no storage. */

export type TaskId = 'wood' | 'rush' | 'check' | 'study' | 'daily' | 'rapid' | 'review' | 'missed' | 'blitz';
export type AutoId = 'wood' | 'rush' | 'check' | 'rapid' | 'review';

export interface Task {
  id: TaskId;
  title: string;
  detail: string;
  minutes: number;
  /** Route that opens the task. */
  to: string;
  /** auto = the app sees it is done, manual = the player ticks it. */
  kind: 'auto' | 'manual';
  /** Not counted in the total. */
  optional?: boolean;
}

export const AUTO_IDS: readonly AutoId[] = ['wood', 'rush', 'check', 'rapid', 'review'];
export const MANUAL_IDS: readonly TaskId[] = ['study', 'daily', 'missed', 'blitz'];

/** Minutes of Woodpecker work that count as a done day even when the quota is not reached. */
export const WOOD_MINUTES = 25;
export const CHECK_TARGET = 10;
export const RAPID_TARGET = 2;

const WOOD: Task = { id: 'wood', title: 'Woodpecker', detail: '25 to 30 minutes on your set.', minutes: 25, to: '/train/woodpecker', kind: 'auto' };
const RUSH: Task = { id: 'rush', title: 'Puzzle Rush, one run', detail: 'One run, about 5 minutes.', minutes: 5, to: '/rush', kind: 'auto' };
const CHECK: Task = { id: 'check', title: 'Blunder check, 10 positions', detail: 'Is the last move safe? Look for checks, captures and threats.', minutes: 5, to: '/train/blunder-check', kind: 'auto' };
const DAILY: Task = { id: 'daily', title: 'Daily games, full check every move', detail: 'Check, capture, threat on every move, before you play it.', minutes: 10, to: '/coach/daily', kind: 'manual' };

const ENDGAMES: Task = { id: 'study', title: 'Endgames', detail: '20 minutes of endgame drills.', minutes: 20, to: '/train/endgames', kind: 'manual' };
const OPENINGS: Task = { id: 'study', title: 'Openings and one opening video', detail: '20 minutes: drill your lines, then watch one opening video.', minutes: 20, to: '/train/openings', kind: 'manual' };
const VIDEO: Task = { id: 'study', title: 'One instructive game video', detail: '20 minutes. Pause and predict each move.', minutes: 20, to: '/coach/library', kind: 'manual' };

const WEEKEND: Task[] = [
  { id: 'rapid', title: '2 to 3 rapid games at 15+10 or 30+0', detail: 'Slow games. Think before each move.', minutes: 90, to: '/play', kind: 'auto' },
  { id: 'review', title: 'Review each game yourself first, then with the engine', detail: 'Write down where it went wrong before the engine tells you.', minutes: 30, to: '/analysis', kind: 'auto' },
  { id: 'missed', title: 'Add the tactics you missed to your next Woodpecker set', detail: 'Pick them from your reviews.', minutes: 5, to: '/train/woodpecker', kind: 'manual' },
  { id: 'blitz', title: 'Optional: 20 to 30 minutes of blitz, stop after two losses in a row', detail: 'Only if you feel fresh.', minutes: 25, to: '/coach', kind: 'manual', optional: true },
];

/** The tasks of one local day: Monday to Friday and the weekend have their own list. */
export function todayTasks(dateKey: string): Task[] {
  if (!isDateKey(dateKey)) return [];
  const wd = weekdayOf(dateKey);
  if (wd >= 5) return WEEKEND.map((t) => ({ ...t }));
  const study = wd === 0 || wd === 3 ? ENDGAMES : wd === 1 ? OPENINGS : VIDEO;
  return [WOOD, RUSH, CHECK, study, DAILY].map((t) => ({ ...t }));
}

/** Ticked manual task ids, cleaned. */
export function cleanTicks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) if (typeof x === 'string' && (MANUAL_IDS as readonly string[]).includes(x) && !out.includes(x)) out.push(x);
  return out;
}

/** The ticks with `id` switched. An id that is not a manual task changes nothing. */
export function toggleId(ticks: readonly string[], id: string): string[] {
  const clean = cleanTicks(ticks);
  if (!(MANUAL_IDS as readonly string[]).includes(id)) return clean;
  return clean.includes(id) ? clean.filter((t) => t !== id) : [...clean, id];
}

/* ---------- days as time ---------- */

/** Local midnight of a date key, in ms. */
export function dayStartMs(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** [start, end) of the local day. */
export function dayBounds(dateKey: string): { start: number; end: number } {
  return { start: dayStartMs(dateKey), end: dayStartMs(addDays(dateKey, 1)) };
}

/* ---------- what the app can see ---------- */

export interface AutoState {
  done: boolean;
  text: string;
}

export interface AutoInputs {
  /** A moment inside the day being judged. */
  now: number;
  /** The newest set with an unfinished cycle, and its attempts. */
  woodSet: Pick<WoodSet, 'id' | 'items' | 'cycles'> | null;
  woodSetAttempts: readonly Attempt[];
  /** Any Woodpecker set exists. */
  anyWoodSet: boolean;
  /** Time spent on Woodpecker attempts today, over all sets. */
  woodMsToday: number;
  /** A cycle was finished today. */
  woodFinishedToday: boolean;
  rushToday: number;
  /** Positions judged in the blunder check today. */
  checkToday: number;
  /** Stored rapid games played today with a known side. */
  rapidToday: number;
  /** Own reviews written today that were not skipped. */
  reviewsToday: number;
}

/** Rapid games of the day for which the player's side is known (bot games count). */
export function countRapidToday(games: readonly Pick<StoredGame, 'source' | 'white' | 'black' | 'importedFor' | 'speed' | 'playedAt'>[], users: KnownUsers, dateKey: string): number {
  let n = 0;
  for (const g of games) if (g.speed === 'rapid' && dayKeyOf(g.playedAt) === dateKey && resolveSide(g, users) !== null) n++;
  return n;
}

/** Hard-to-read counts: one place for wording. */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function woodState(i: AutoInputs): AutoState {
  const minutes = Math.floor(i.woodMsToday / 60_000);
  const timeDone = i.woodMsToday >= WOOD_MINUTES * 60_000;
  let paceDone = false;
  let text = '';
  const cycle = i.woodSet ? currentCycle(i.woodSet) : undefined;
  if (i.woodFinishedToday) text = 'Cycle finished today';
  else if (i.woodSet && cycle) {
    const p = pace(i.woodSet, cycle.n, i.woodSetAttempts, i.now);
    paceDone = p.doneToday > 0 && p.todayQuota === 0;
    text = p.doneToday === 0 && p.todayGoal === 0 ? 'Ahead of pace' : `${p.doneToday} of ${Math.max(p.todayGoal, p.doneToday)} today`;
  } else if (i.woodMsToday > 0) text = `${plural(minutes, 'minute', 'minutes')} today`;
  else text = i.anyWoodSet ? 'No cycle running' : 'No set yet';
  return { done: paceDone || timeDone || i.woodFinishedToday, text };
}

/** For every task the app can judge by itself: is it done, and a short line to show next to it. */
export function autoState(i: AutoInputs): Record<AutoId, AutoState> {
  const needReviews = Math.max(1, Math.min(3, i.rapidToday));
  return {
    wood: woodState(i),
    rush: { done: i.rushToday > 0, text: i.rushToday > 0 ? plural(i.rushToday, 'run', 'runs') : 'No run yet' },
    check: { done: i.checkToday >= CHECK_TARGET, text: `${Math.min(i.checkToday, CHECK_TARGET)} of ${CHECK_TARGET}` },
    rapid: { done: i.rapidToday >= RAPID_TARGET, text: `${Math.min(i.rapidToday, RAPID_TARGET)} of ${RAPID_TARGET}` },
    review: { done: i.reviewsToday >= needReviews, text: `${Math.min(i.reviewsToday, needReviews)} of ${needReviews}` },
  };
}

export interface DaySummary {
  done: number;
  total: number;
}

/** Tasks done out of the tasks that count (optional ones are left out). */
export function summary(tasks: readonly Task[], auto: Partial<Record<string, AutoState>>, ticks: readonly string[]): DaySummary {
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (t.optional) continue;
    total++;
    if (t.kind === 'auto' ? auto[t.id]?.done : ticks.includes(t.id)) done++;
  }
  return { done, total };
}
