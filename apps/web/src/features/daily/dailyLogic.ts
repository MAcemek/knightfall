import { addDays, dailyStreak, utcDateKey } from '@knightfall/core';
import type { DailyRecord } from '../../shared/db.ts';

/**
 * A db.daily row. `solved`/`clean` only ever mean a SAME-DAY result (so anything reading db.daily for the
 * streak keeps working); late plays use the optional `solvedLate` / `playedLate` flags.
 */
export type DailyEntry = DailyRecord;

export interface DailyOutcome {
  date: string;
  puzzleId: string;
  solved: boolean;
  /** First try, no hints. */
  clean: boolean;
  /** Played after `date` had already ended (UTC). */
  late: boolean;
  at: number;
}

/**
 * Merge a new outcome into the stored record. Returns the record to write, or null to leave it alone.
 *  - never overwrite a same-day solve
 *  - never overwrite anything with a failure
 *  - a later solve upgrades an earlier failure (same day → counts, but is not clean; late → solvedLate)
 */
export function mergeDaily(existing: DailyEntry | undefined, o: DailyOutcome): DailyEntry | null {
  if (!existing) {
    if (o.late) {
      return { date: o.date, puzzleId: o.puzzleId, solved: false, clean: false, solvedLate: o.solved, playedLate: true, at: o.at };
    }
    return { date: o.date, puzzleId: o.puzzleId, solved: o.solved, clean: o.solved && o.clean, at: o.at };
  }
  if (existing.solved || !o.solved) return null;
  if (o.late) return existing.solvedLate ? null : { ...existing, solvedLate: true, at: o.at };
  return { ...existing, solved: true, clean: false, at: o.at };
}

/** Streak over same-day solves only. */
export function streakOf(records: Iterable<DailyEntry>, todayKey: string): number {
  const dates: string[] = [];
  for (const r of records) if (r.solved) dates.push(r.date);
  return dailyStreak(dates, todayKey);
}

/** Longest run of consecutive same-day solves. */
export function bestStreakOf(records: Iterable<DailyEntry>): number {
  const set = new Set<string>();
  for (const r of records) if (r.solved) set.add(r.date);
  let best = 0;
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue; // not the start of a run
    let n = 0;
    let cur = d;
    while (set.has(cur)) {
      n++;
      cur = addDays(cur, 1);
    }
    best = Math.max(best, n);
  }
  return best;
}

export type DayKind = 'clean' | 'solved' | 'late' | 'failed' | 'missed' | 'open' | 'pending' | 'future';

/**
 * How a calendar day looks.
 *  - 'open': a past day from before the player's first daily (not counted as missed)
 *  - 'pending': today, not solved yet
 */
export function dayKind(date: string, todayKey: string, rec: DailyEntry | undefined, firstPlayed: string | null): DayKind {
  if (date > todayKey) return 'future';
  if (rec?.solved) return rec.clean ? 'clean' : 'solved';
  if (rec?.solvedLate) return 'late';
  if (date === todayKey) return 'pending';
  if (rec) return 'failed';
  if (!firstPlayed || date < firstPlayed) return 'open';
  return 'missed';
}

/** Calendar cells for a month ("YYYY-MM"), Sunday-first, padded with nulls. */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(utcDateKey(new Date(Date.UTC(y, m - 1, d))));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function monthOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return utcDateKey(d).slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function dayLabel(dateKey: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' }): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

/** Milliseconds until the next UTC midnight. */
export function msToNextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

export function formatHMS(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function isDateKey(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && utcDateKey(d) === s;
}

/** Spoiler-free share text. */
export function shareText(o: { date: string; solved: boolean; late: boolean; moves: number; streak: number; clean: boolean }): string {
  const mark = o.solved ? '✅' : '❌';
  const parts = [`${o.moves} move${o.moves === 1 ? '' : 's'}`];
  if (o.solved && o.clean && !o.late) parts.push('first try');
  if (o.late) parts.push('played late');
  if (!o.late && o.streak > 0) parts.push(`streak ${o.streak}🔥`);
  return `Knightfall Daily ${o.date} ${mark} ${parts.join(' · ')}`;
}

/** Earliest date with any daily record (null when none). */
export function firstPlayedDate(records: Iterable<DailyEntry>): string | null {
  let min: string | null = null;
  for (const r of records) if (!min || r.date < min) min = r.date;
  return min;
}

/** The earliest month the calendar lets you browse to. */
export const MIN_MONTH = '2024-01';
