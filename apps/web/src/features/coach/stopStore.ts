import { useLiveQuery } from 'dexie-react-hooks';
import { db, KEYS, type CoachDay } from '../../shared/db.ts';
import { isDateKey } from '../../shared/localDate.ts';
import { cleanTicks } from './todayLogic.ts';
import { blitzSession, bulletThisWeek, sanitizeActivity, sanitizeNotes, withNote, withoutLastNote, type BlitzNote, type BlitzSession, type BulletWeek, type CoachActivity } from './stopRules.ts';

/** Synced fast games and hand-noted blitz results in the local database. The rules are in stopRules.ts. */

/** The stored activity, cleaned. Read-only, so it is safe inside a live query. */
export async function readActivity(): Promise<CoachActivity> {
  const row = await db.kv.get(KEYS.coachActivity);
  return sanitizeActivity(row?.value);
}

/** Live activity. Undefined while loading. */
export function useActivity(): CoachActivity | undefined {
  return useLiveQuery(readActivity, []);
}

export interface StopState {
  bullet: BulletWeek;
  blitz: BlitzSession;
  /** The notes of the day, oldest first (the page shows an undo for the last one). */
  notes: BlitzNote[];
  lastSync: number | null;
}

/** Bullet count (in the plan week that starts from `startDate`) and blitz streak for `today`, live. Undefined while loading. */
export function useStopState(today: string, startDate?: string): StopState | undefined {
  return useLiveQuery(async () => {
    const [activity, day] = await Promise.all([readActivity(), db.coachDays.get(today)]);
    const notes = sanitizeNotes(day?.blitz);
    return { bullet: bulletThisWeek(activity.games, today, startDate), blitz: blitzSession(activity.games, notes, today), notes, lastSync: activity.lastSync };
  }, [today, startDate]);
}

/** Saves a day row; a row with nothing in it is removed. */
export async function putDay(date: string, ticks: string[], blitz: BlitzNote[]): Promise<void> {
  if (!ticks.length && !blitz.length) await db.coachDays.delete(date);
  else await db.coachDays.put({ date, ticks, blitz } satisfies CoachDay);
}

/** Notes one blitz result by hand on `date`. */
export async function addBlitz(date: string, result: 'win' | 'loss', now = Date.now()): Promise<void> {
  if (!isDateKey(date)) return;
  await db.transaction('rw', db.coachDays, async () => {
    const row = await db.coachDays.get(date);
    await putDay(date, cleanTicks(row?.ticks), withNote(sanitizeNotes(row?.blitz), now, result));
  });
}

/** Takes the newest hand-noted result of `date` back. */
export async function undoBlitz(date: string): Promise<void> {
  if (!isDateKey(date)) return;
  await db.transaction('rw', db.coachDays, async () => {
    const row = await db.coachDays.get(date);
    if (!row) return;
    await putDay(date, cleanTicks(row.ticks), withoutLastNote(sanitizeNotes(row.blitz)));
  });
}
