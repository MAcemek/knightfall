import { hashString } from './rng.ts';

/** YYYY-MM-DD in UTC. */
export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Deterministic index of the daily puzzle for a date key within a pool. */
export function dailyIndex(dateKey: string, poolSize: number): number {
  if (poolSize <= 0) return 0;
  return hashString(`knightfall-daily:${dateKey}`) % poolSize;
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateKey(d);
}

/** Current daily streak: consecutive solved days ending today (or yesterday if today isn't solved yet). */
export function dailyStreak(solvedDates: Iterable<string>, todayKey: string): number {
  const set = new Set(solvedDates);
  let cursor = set.has(todayKey) ? todayKey : addDays(todayKey, -1);
  let n = 0;
  while (set.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}
