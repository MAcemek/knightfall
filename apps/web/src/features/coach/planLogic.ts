import { addDays } from '@knightfall/core';
import type { CoachSpeed } from '../../shared/db.ts';
import { USERNAME } from '../../shared/importers/mappers.ts';
import { daysBetween, isDateKey } from '../../shared/localDate.ts';

/** The 12-week training plan: what is stored, the suggested targets and where today falls in the weeks. No React, no storage. */

export const COACH_SPEEDS: readonly CoachSpeed[] = ['rapid', 'blitz', 'bullet', 'daily'];

export const SPEED_LABEL: Record<CoachSpeed, string> = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', daily: 'Daily' };

export const MIN_RATING = 100;
export const MAX_RATING = 4000;

/** Length of the plan in days (12 weeks). */
export const PLAN_DAYS = 84;

export interface SpeedTarget {
  /** Rating wanted after three months. */
  three: number | null;
  /** Rating wanted after six months. */
  six: number | null;
}

export interface CoachPlan {
  /** chess.com username as typed; '' = none (no sync). */
  username: string;
  /** Local date the plan starts, YYYY-MM-DD. */
  startDate: string;
  baselines: Record<CoachSpeed, number | null>;
  targets: Record<CoachSpeed, SpeedTarget>;
}

/** A whole rating from 100 to 4000, else null. */
export function cleanRating(x: unknown): number | null {
  return typeof x === 'number' && Number.isInteger(x) && x >= MIN_RATING && x <= MAX_RATING ? x : null;
}

/** What a person typed in a rating box: '' or anything unusable is null. */
export function parseRatingInput(text: string): number | null {
  const t = text.trim();
  return /^\d{3,4}$/.test(t) ? cleanRating(Number(t)) : null;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function cleanUsername(x: unknown): string {
  if (typeof x !== 'string') return '';
  const t = x.trim();
  return USERNAME.test(t) ? t : '';
}

export function emptyTargets(): Record<CoachSpeed, SpeedTarget> {
  return { rapid: { three: null, six: null }, blitz: { three: null, six: null }, bullet: { three: null, six: null }, daily: { three: null, six: null } };
}

export function emptyBaselines(): Record<CoachSpeed, number | null> {
  return { rapid: null, blitz: null, bullet: null, daily: null };
}

/** The stored plan, cleaned. Null when there is none or it has no valid start date. */
export function sanitizePlan(raw: unknown): CoachPlan | null {
  if (!isRecord(raw) || !isDateKey(raw.startDate)) return null;
  const b = isRecord(raw.baselines) ? raw.baselines : {};
  const t = isRecord(raw.targets) ? raw.targets : {};
  const baselines = emptyBaselines();
  const targets = emptyTargets();
  for (const s of COACH_SPEEDS) {
    baselines[s] = cleanRating(b[s]);
    const one = isRecord(t[s]) ? t[s] : {};
    targets[s] = { three: cleanRating(one.three), six: cleanRating(one.six) };
  }
  return { username: cleanUsername(raw.username), startDate: raw.startDate, baselines, targets };
}

/** Rapid and blitz have a steady climb, bullet only holds, Daily is pulled toward the rapid rating when it lags far behind. */
export function suggestTargets(baselines: Record<CoachSpeed, number | null>): Record<CoachSpeed, SpeedTarget> {
  const out = emptyTargets();
  const plus = (base: number | null, a: number, b: number): SpeedTarget => (base === null ? { three: null, six: null } : { three: base + a, six: base + b });
  out.rapid = plus(baselines.rapid, 70, 125);
  out.blitz = plus(baselines.blitz, 75, 135);
  out.bullet = { three: baselines.bullet, six: null };
  const daily = baselines.daily;
  const rapid = baselines.rapid;
  if (daily === null) out.daily = { three: null, six: null };
  else if (rapid !== null && rapid - daily >= 200) {
    const gap = rapid - daily;
    out.daily = { three: Math.round(daily + gap * 0.5), six: Math.round(daily + gap * 0.85) };
  } else out.daily = plus(daily, 50, 100);
  return out;
}

/* ---------- the weeks ---------- */

export type WeekState = 'before' | 'running' | 'after';

export interface WeekInfo {
  state: WeekState;
  /** Day of the plan, 1-based. 0 before the start, 84 after the end. */
  day: number;
  /** 1 to 12. */
  week: number;
  /** 1 to 3. */
  phase: 1 | 2 | 3;
  /** Whole days from the start date to today (negative before the start). */
  offset: number;
}

export function weekInfo(startDate: string, today: string): WeekInfo {
  const offset = daysBetween(startDate, today);
  if (offset < 0) return { state: 'before', day: 0, week: 1, phase: 1, offset };
  if (offset >= PLAN_DAYS) return { state: 'after', day: PLAN_DAYS, week: 12, phase: 3, offset };
  const week = Math.floor(offset / 7) + 1;
  return { state: 'running', day: offset + 1, week, phase: Math.ceil(week / 4) as 1 | 2 | 3, offset };
}

/** First day of the plan week that `date` falls in (weeks of 7 days from `startDate`; before the start it counts backwards). */
export function planWeekStart(startDate: string, date: string): string {
  return addDays(startDate, 7 * Math.floor(daysBetween(startDate, date) / 7));
}

export const PHASES: Record<1 | 2 | 3, string> = {
  1: 'Woodpecker cycle 1, slow and careful. Rebuild the blunder check in rapid. At most 10 bullet games a week.',
  2: 'Woodpecker cycles 2 and 3. Settle on one White opening and two Black replies. Start rook endgames.',
  3: 'Woodpecker cycles 4 and up. Play an over-the-board tournament. Review every game and teach one lesson at your club.',
};
