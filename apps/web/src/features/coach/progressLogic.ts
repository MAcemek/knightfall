import { addDays, parsePgnGame } from '@knightfall/core';
import type { CoachSpeed, RatingLogRow } from '../../shared/db.ts';
import { daysBetween, isDateKey } from '../../shared/localDate.ts';
import { cycleSummaries, type CycleSummary } from '../woodpecker/woodLogic.ts';
import type { CoachPlan } from './planLogic.ts';

/** Progress numbers: ratings against the target line, blunders per game, clock use. Pure, no storage. */

/* ---------- ratings ---------- */

export interface RatingPoint {
  date: string;
  rating: number;
}

/**
 * One rating per day for one speed, oldest first. A damaged row is skipped. With a username, only that account's rows count
 * (case-insensitive); rows without a username count as matching. Without one, all rows.
 */
export function ratingSeries(rows: readonly Partial<RatingLogRow>[], speed: CoachSpeed, user?: string): RatingPoint[] {
  const byDate = new Map<string, number>();
  const want = user ? user.toLowerCase() : '';
  for (const r of rows) {
    if (!r || r.speed !== speed || (want && typeof r.user === 'string' && r.user.toLowerCase() !== want) ||!isDateKey(r.date) || typeof r.rating !== 'number' || !Number.isFinite(r.rating) || r.rating <= 0) continue;
    byDate.set(r.date, r.rating);
  }
  return [...byDate.entries()].map(([date, rating]) => ({ date, rating })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface LinePoint {
  date: string;
  value: number;
}

export interface TargetLine {
  points: LinePoint[];
  /** Value of the line on a date: straight between the points, flat before the first and after the last. */
  valueAt(date: string): number;
}

/** Days from the start of the plan to the three-month and six-month marks. */
export const THREE_MONTH_DAYS = 91;
export const SIX_MONTH_DAYS = 182;

/** The line from the starting rating to the three and six month targets. Null without a starting rating or a target. */
export function targetLine(plan: Pick<CoachPlan, 'startDate' | 'baselines' | 'targets'>, speed: CoachSpeed): TargetLine | null {
  const base = plan.baselines[speed];
  if (base === null || !isDateKey(plan.startDate)) return null;
  const t = plan.targets[speed];
  const points: LinePoint[] = [{ date: plan.startDate, value: base }];
  if (t.three !== null) points.push({ date: addDays(plan.startDate, THREE_MONTH_DAYS), value: t.three });
  if (t.six !== null) points.push({ date: addDays(plan.startDate, SIX_MONTH_DAYS), value: t.six });
  if (points.length < 2) return null;
  return {
    points,
    valueAt(date) {
      if (!isDateKey(date) || date <= points[0].date) return points[0].value;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (date <= b.date) {
          const span = daysBetween(a.date, b.date);
          return span <= 0 ? b.value : a.value + ((b.value - a.value) * daysBetween(a.date, date)) / span;
        }
      }
      return points[points.length - 1].value;
    },
  };
}

export interface RatingDelta {
  date: string;
  rating: number;
  target: number;
  /** Rating minus the line: positive = ahead. */
  delta: number;
}

/** How the newest rating compares to the line on its own day. Null without a rating or a line. */
export function ratingDelta(series: readonly RatingPoint[], line: TargetLine | null): RatingDelta | null {
  const last = series[series.length - 1];
  if (!last || !line) return null;
  const target = line.valueAt(last.date);
  return { date: last.date, rating: last.rating, target, delta: last.rating - target };
}

/* ---------- blunders per game ---------- */

export interface BlunderRow {
  playedAt: number;
  /** Blunders of the player's own side, from the stored report. */
  blunders: number;
}

export interface BlunderStat {
  /** Mean over the newest 10 analysed games. */
  last: number | null;
  /** Mean over the 10 before them; null with fewer than 3 games. */
  previous: number | null;
  /** Half of `previous`. */
  goal: number | null;
  games: { last: number; previous: number };
}

const GROUP = 10;
const MIN_PREVIOUS = 3;

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function blundersPerGame(rows: readonly BlunderRow[]): BlunderStat {
  const sorted = rows.filter((r) => Number.isFinite(r.blunders) && r.blunders >= 0).sort((a, b) => b.playedAt - a.playedAt);
  const last = sorted.slice(0, GROUP).map((r) => r.blunders);
  const prev = sorted.slice(GROUP, GROUP * 2).map((r) => r.blunders);
  const previous = prev.length >= MIN_PREVIOUS ? mean(prev) : null;
  return {
    last: last.length ? mean(last) : null,
    previous,
    goal: previous === null ? null : previous / 2,
    games: { last: last.length, previous: prev.length },
  };
}

/* ---------- clock use ---------- */

export interface ClockRow {
  pgn: string;
  side: 'w' | 'b';
  /** Stored time control, used when the PGN has none. */
  timeControl?: string;
}

export interface ClockStat {
  /** Mean share of the time budget used, 0 to 1, over the newest qualifying games. Null without any. */
  share: number | null;
  games: number;
  state: 'low' | 'good' | null;
}

export const CLOCK_LOW = 0.6;
const CLOCK_MIN_MOVES = 15;
const CLOCK_PARSE_MAX = 15;
const CLOCK_GAMES = 10;

/** "600" -> { base: 600, inc: 0 }, "900+10" -> { base: 900, inc: 10 }. Daily ("1/86400") and anything else is null. */
export function parseTimeControl(tc: string | undefined): { base: number; inc: number } | null {
  const m = /^(\d{1,5})(?:\+(\d{1,4}))?$/.exec((tc ?? '').trim());
  if (!m) return null;
  const base = Number(m[1]);
  return base > 0 ? { base, inc: m[2] ? Number(m[2]) : 0 } : null;
}

/** Share of the time budget one game used for the player's side. Null when the game cannot say. */
export function gameClockShare(row: ClockRow): number | null {
  const parsed = parsePgnGame(row.pgn);
  if (!parsed.ok) return null;
  const g = parsed.game;
  const tc = parseTimeControl(g.headers.TimeControl ?? row.timeControl);
  if (!tc) return null;
  const mine = g.clocksMs.map((c, i) => ({ c, i })).filter((x) => (x.i % 2 === 0) === (row.side === 'w'));
  if (mine.length < CLOCK_MIN_MOVES) return null;
  const left = mine[mine.length - 1].c;
  if (left === null) return null;
  const budget = (tc.base + tc.inc * mine.length) * 1000;
  return Math.min(1, Math.max(0, (budget - left) / budget));
}

/** Rows are rapid games, newest first, not played against the built-in bot. At most the newest 15 are read. */
export function clockShare(rows: readonly ClockRow[]): ClockStat {
  const shares: number[] = [];
  for (const row of rows.slice(0, CLOCK_PARSE_MAX)) {
    if (shares.length >= CLOCK_GAMES) break;
    const s = gameClockShare(row);
    if (s !== null) shares.push(s);
  }
  if (!shares.length) return { share: null, games: 0, state: null };
  const share = mean(shares);
  return { share, games: shares.length, state: share < CLOCK_LOW ? 'low' : 'good' };
}

/* ---------- Woodpecker times ---------- */

/** The newest set (by creation time), or null. */
export function newestSet<T extends { createdAt: number }>(sets: readonly T[]): T | null {
  let best: T | null = null;
  for (const s of sets) if (!best || s.createdAt > best.createdAt) best = s;
  return best;
}

/** Time per cycle of a set, for the progress chart. */
export function woodTimes(set: Parameters<typeof cycleSummaries>[0], attempts: Parameters<typeof cycleSummaries>[1]): CycleSummary[] {
  return cycleSummaries(set, attempts);
}
