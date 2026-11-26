import { addDays } from '@knightfall/core';
import type { CoachDay, CoachSpeed, GameSource, RatingLogRow } from '../../shared/db.ts';
import { daysBetween, dayKeyOf, weekStart } from '../../shared/localDate.ts';
import { dayScore, type BlunderTotals } from '../blundercheck/blunderLogic.ts';
import { COACH_SPEEDS, PLAN_DAYS, type CoachPlan } from './planLogic.ts';
import { CLOCK_LOW, clockShare, ratingDelta, ratingSeries, targetLine, type ClockRow, type ClockStat } from './progressLogic.ts';
import { BULLET_LIMIT, blitzSession, type CoachActivity } from './stopRules.ts';
import { BLUNDER_HIGH, FOCUS_TARGET } from './adaptLogic.ts';
import { CHECK_TARGET, RAPID_TARGET, WOOD_MINUTES, cleanTicks, todayTasks, type ListId } from './todayLogic.ts';

/** The weekly review: counts for one local Monday to Sunday of the plan. Pure functions over plain arrays, no storage. */

/* ---------- which week ---------- */

export interface WeekRange {
  /** Monday of the week the plan starts in. */
  first: string;
  /** Monday of the week the plan ends in. */
  last: string;
}

export function planWeekRange(startDate: string): WeekRange {
  return { first: weekStart(startDate), last: weekStart(addDays(startDate, PLAN_DAYS - 1)) };
}

const clampWeek = (monday: string, range: WeekRange) => (monday < range.first ? range.first : monday > range.last ? range.last : monday);

/** The Monday to show first: this week, kept inside the plan. */
export function defaultWeek(range: WeekRange, today: string): string {
  return clampWeek(weekStart(today), range);
}

/** The Monday `step` weeks away, kept inside the plan. */
export function shiftWeek(monday: string, step: number, range: WeekRange): string {
  return clampWeek(addDays(monday, step * 7), range);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 1-based number of the week inside the plan. */
export function weekNumber(monday: string, range: WeekRange): number {
  return Math.round(daysBetween(range.first, monday) / 7) + 1;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "17 Nov" */
export function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? ''}`.trim();
}

/** "17 Nov to 23 Nov" */
export function weekLabel(monday: string): string {
  return `${shortDate(monday)} to ${shortDate(addDays(monday, 6))}`;
}

/* ---------- the week's facts ---------- */

export interface WeekGame {
  playedAt: number;
  source: GameSource;
  speed?: string;
  /** The player's side, when known. */
  side: 'w' | 'b' | null;
  /** Own blunders from the stored report; null when the game has none. */
  blunders: number | null;
  /** Set for rapid games played on a site, not against the bot, with a known side. */
  clock: ClockRow | null;
}

export interface WeekInput {
  monday: string;
  today: string;
  plan: Pick<CoachPlan, 'username' | 'startDate' | 'baselines' | 'targets'>;
  woodAttempts: readonly { at: number; solved: boolean; timeMs: number }[];
  /** When Woodpecker cycles were finished, ms. */
  woodFinishedAt: readonly number[];
  rushRuns: readonly { at: number; score: number }[];
  checkTotals: BlunderTotals;
  games: readonly WeekGame[];
  reviews: readonly { at: number; skipped: boolean }[];
  days: readonly Pick<CoachDay, 'date' | 'ticks' | 'blitz'>[];
  activity: CoachActivity;
  ratings: readonly Partial<RatingLogRow>[];
  /** Blunder check positions that make a day (the adapted target of the Today page). Default CHECK_TARGET. */
  checkTarget?: number;
  /** Train theme of the focus task, or null when there is none. */
  focusTheme?: string | null;
  /** Theme trainer attempts of the week. */
  themeAttempts?: readonly { at: number; themes?: readonly string[] }[];
}

export type KindId = Exclude<ListId, 'blitz'>;

const KINDS: readonly { id: KindId; label: string; to: string }[] = [
  { id: 'wood', label: 'Woodpecker', to: '/train/woodpecker' },
  { id: 'rush', label: 'Puzzle Rush', to: '/rush' },
  { id: 'check', label: 'Blunder check', to: '/train/blunder-check' },
  { id: 'focus', label: 'Focus theme', to: '/train' },
  { id: 'study', label: 'Study', to: '/coach/library' },
  { id: 'daily', label: 'Daily games', to: '/coach/daily' },
  { id: 'rapid', label: 'Rapid games', to: '/play' },
  { id: 'review', label: 'Game reviews', to: '/analysis' },
  { id: 'missed', label: 'Missed tactics', to: '/train/woodpecker' },
];

export interface KindCount {
  id: KindId;
  label: string;
  /** Days the task was done. */
  done: number;
  /** Days it was on the list, from the plan start up to today. */
  planned: number;
  to: string;
}

/** Per day, which tasks were done. Same rules as the Today page, except Woodpecker pace (it needs the day's own history). The check and focus targets are the ones Today shows now. */
function doneOn(date: string, i: WeekInput): Record<KindId, boolean> {
  const ticks = cleanTicks(i.days.find((d) => d.date === date)?.ticks);
  const on = (ms: number) => dayKeyOf(ms) === date;
  const woodMs = i.woodAttempts.filter((a) => on(a.at)).reduce((s, a) => s + (Number.isFinite(a.timeMs) && a.timeMs > 0 ? a.timeMs : 0), 0);
  const rapid = i.games.filter((g) => g.speed === 'rapid' && g.side !== null && on(g.playedAt)).length;
  const reviews = i.reviews.filter((r) => !r.skipped && on(r.at)).length;
  return {
    wood: woodMs >= WOOD_MINUTES * 60_000 || i.woodFinishedAt.some(on),
    rush: i.rushRuns.some((r) => on(r.at)),
    check: dayScore(i.checkTotals, date).total >= (i.checkTarget ?? CHECK_TARGET),
    focus: !!i.focusTheme && (i.themeAttempts ?? []).filter((a) => on(a.at) && a.themes?.includes(i.focusTheme as string)).length >= FOCUS_TARGET,
    rapid: rapid >= RAPID_TARGET,
    // A ticked review counts too: with "Review it yourself first" off the player ticks it by hand.
    review: reviews >= Math.max(1, Math.min(3, rapid)) || ticks.includes('review'),
    study: ticks.includes('study'),
    daily: ticks.includes('daily'),
    missed: ticks.includes('missed'),
  };
}

export interface Weekly {
  /** Days with at least one task done. */
  daysActive: number;
  kinds: KindCount[];
}

/** Counts days from Monday to Sunday of the week, only inside the plan and never after today. This is the one "days active" number in the app. */
export function weekActivity(i: WeekInput): Weekly {
  let daysActive = 0;
  const kinds: KindCount[] = KINDS.map((k) => ({ ...k, done: 0, planned: 0, ...(k.id === 'focus' && i.focusTheme ? { to: `/train/theme/${i.focusTheme}` } : {}) }));
  const lastPlanDay = addDays(i.plan.startDate, PLAN_DAYS - 1);
  for (const date of weekDays(i.monday)) {
    if (date > i.today) break;
    if (date < i.plan.startDate || date > lastPlanDay) continue;
    const done = doneOn(date, i);
    if (Object.values(done).some(Boolean)) daysActive++;
    const planned = new Set<ListId>(todayTasks(date).flatMap((t) => (t.id === 'check' && i.focusTheme ? [t.id, 'focus' as const] : [t.id])));
    for (const k of kinds) {
      if (done[k.id]) k.done++;
      if (planned.has(k.id)) k.planned++;
    }
  }
  return { daysActive, kinds: kinds.filter((k) => k.id !== 'focus' || k.planned > 0 || k.done > 0) };
}

/* ---------- numbers ---------- */

const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export interface PuzzleWeek {
  woodDone: number;
  /** 0 to 1, null without attempts. */
  woodAccuracy: number | null;
  rushRuns: number;
  rushBest: number | null;
  checkTotal: number;
  /** 0 to 1, null without positions. */
  checkRight: number | null;
}

export function puzzleWeek(i: WeekInput): PuzzleWeek {
  const solved = i.woodAttempts.filter((a) => a.solved).length;
  const scores = i.rushRuns.map((r) => r.score).filter((s) => Number.isFinite(s));
  let total = 0;
  let correct = 0;
  for (const date of weekDays(i.monday)) {
    const d = dayScore(i.checkTotals, date);
    total += d.total;
    correct += d.correct;
  }
  return {
    woodDone: i.woodAttempts.length,
    woodAccuracy: share(solved, i.woodAttempts.length),
    rushRuns: i.rushRuns.length,
    rushBest: scores.length ? Math.max(...scores) : null,
    checkTotal: total,
    checkRight: share(correct, total),
  };
}

export interface GameWeek {
  /** Rapid games from a site or an import, with a known side. */
  rapid: number;
  /** Games against the built-in bot. */
  bot: number;
  /** Own reviews written, not skipped. */
  reviews: number;
  /** Rapid games with a stored analysis, and the mean blunders in them. */
  analysed: number;
  blundersPerGame: number | null;
  clock: ClockStat;
  bullet: number;
  bulletLimit: number;
  /** Synced fast games cover this week (they are kept for 35 days after a sync). */
  fastKnown: boolean;
  /** Days that reached two blitz losses in a row. */
  blitzStopDays: number;
}

const FAST_KEEP_DAYS = 34;

export function gameWeek(i: WeekInput): GameWeek {
  const sunday = addDays(i.monday, 6);
  const rapidSite = i.games.filter((g) => g.source !== 'bot' && g.speed === 'rapid' && g.side !== null);
  const blunders = rapidSite.flatMap((g) => (g.blunders !== null && Number.isFinite(g.blunders) && g.blunders >= 0 ? [g.blunders] : []));
  const clockRows = i.games
    .filter((g) => g.clock)
    .sort((a, b) => b.playedAt - a.playedAt)
    .map((g) => g.clock as ClockRow);
  let stops = 0;
  for (const date of weekDays(i.monday)) {
    const notes = i.days.find((d) => d.date === date)?.blitz ?? [];
    if (blitzSession(i.activity.games, notes, date).stop) stops++;
  }
  return {
    rapid: rapidSite.length,
    bot: i.games.filter((g) => g.source === 'bot').length,
    reviews: i.reviews.filter((r) => !r.skipped).length,
    analysed: blunders.length,
    blundersPerGame: blunders.length ? blunders.reduce((s, x) => s + x, 0) / blunders.length : null,
    clock: clockShare(clockRows),
    bullet: i.activity.games.filter((g) => g.speed === 'bullet' && dayKeyOf(g.at) >= i.monday && dayKeyOf(g.at) <= sunday).length,
    bulletLimit: BULLET_LIMIT,
    fastKnown: i.activity.lastSync !== null && i.monday >= addDays(i.today, -FAST_KEEP_DAYS),
    blitzStopDays: stops,
  };
}

export interface RatingWeek {
  speed: CoachSpeed;
  first: number;
  last: number;
  /** Last minus first; null with one rating only. */
  change: number | null;
  /** Rating minus the target line on the last rating's day; null without a line. */
  fromLine: number | null;
}

export function ratingWeek(i: WeekInput): RatingWeek[] {
  const sunday = addDays(i.monday, 6);
  const rows = i.ratings.filter((r) => typeof r.date === 'string' && r.date >= i.monday && r.date <= sunday);
  const out: RatingWeek[] = [];
  for (const speed of COACH_SPEEDS) {
    const series = ratingSeries(rows, speed, i.plan.username || undefined);
    if (!series.length) continue;
    const first = series[0].rating;
    const last = series[series.length - 1].rating;
    const delta = ratingDelta(series, targetLine(i.plan, speed));
    out.push({ speed, first, last, change: series.length > 1 ? last - first : null, fromLine: delta ? Math.round(delta.delta) : null });
  }
  return out;
}

/* ---------- next week ---------- */

export interface Focus {
  text: string;
  to: string;
  label: string;
}

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** At most two sentences from plain rules, most important first. */
export function nextFocus(i: { daysActive: number; kinds: readonly KindCount[]; games: GameWeek }): Focus[] {
  const { games } = i;
  if (i.daysActive === 0) {
    return [{ text: 'No task was done this week. Start next week with the blunder check, it takes about 5 minutes.', to: '/train/blunder-check', label: 'Open blunder check' }];
  }
  const out: Focus[] = [];
  if (games.blundersPerGame !== null && games.blundersPerGame >= BLUNDER_HIGH) {
    out.push({ text: `You made ${one(games.blundersPerGame)} blunders per rapid game. Run the check on every move in your next games.`, to: '/coach/daily', label: 'Open daily helper' });
  }
  if (games.clock.share !== null && games.clock.share < CLOCK_LOW) {
    out.push({ text: `You used ${Math.round(games.clock.share * 100)}% of your time. Slow down and use more of the clock.`, to: '/play', label: 'Play a game' });
  }
  if (games.fastKnown && games.bullet >= games.bulletLimit) {
    out.push({ text: `You played ${games.bullet} bullet games. Keep it to ${games.bulletLimit} or fewer next week and play rapid instead.`, to: '/coach', label: 'Open Today' });
  }
  if (games.blitzStopDays > 0) {
    out.push({ text: `You hit two blitz losses in a row on ${games.blitzStopDays} ${games.blitzStopDays === 1 ? 'day' : 'days'}. Stop at the second loss.`, to: '/coach', label: 'Open Today' });
  }
  let weakest: KindCount | null = null;
  let worst = 1;
  for (const k of i.kinds) {
    if (k.planned === 0) continue;
    const r = Math.min(k.done, k.planned) / k.planned;
    if (r < worst) {
      worst = r;
      weakest = k;
    }
  }
  if (weakest) out.push({ text: `${weakest.label} was done on ${weakest.done} of ${weakest.planned} planned days. Do it first on the next one.`, to: weakest.to, label: `Open ${weakest.label.toLowerCase()}` });
  if (!out.length) out.push({ text: 'Everything planned was done. Keep the same plan next week.', to: '/coach', label: 'Open Today' });
  return out.slice(0, 2);
}

/* ---------- all together ---------- */

export interface WeekSummary extends Weekly {
  puzzles: PuzzleWeek;
  games: GameWeek;
  ratings: RatingWeek[];
  focus: Focus[];
  /** The week has not started yet. */
  future: boolean;
  /** Nothing was recorded. */
  empty: boolean;
}

export function summarizeWeek(i: WeekInput): WeekSummary {
  const act = weekActivity(i);
  const puzzles = puzzleWeek(i);
  const games = gameWeek(i);
  const ratings = ratingWeek(i);
  const future = i.monday > i.today;
  const empty =
    act.daysActive === 0 && !puzzles.woodDone && !puzzles.rushRuns && !puzzles.checkTotal && !games.rapid && !games.bot && !games.reviews && !games.bullet && !games.blitzStopDays && !ratings.length;
  return { ...act, puzzles, games, ratings, focus: future || empty ? [] : nextFocus({ ...act, games }), future, empty };
}
