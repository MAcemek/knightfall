import { addDays } from '@knightfall/core';

/** Calendar days in the device's own time zone (the Daily puzzle uses UTC days instead: utcDateKey in core). */

/** YYYY-MM-DD in the device's local time zone. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayKeyOf(ms: number): string {
  return localDateKey(new Date(ms));
}

export function isDateKey(x: unknown): x is string {
  return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`)) && addDays(x, 0) === x;
}

/** 0 = Monday ... 6 = Sunday. A calendar date has the same weekday in every time zone. */
export function weekdayOf(dateKey: string): number {
  return (new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The Monday of the week that `dateKey` is in. */
export function weekStart(dateKey: string): string {
  return addDays(dateKey, -weekdayOf(dateKey));
}
