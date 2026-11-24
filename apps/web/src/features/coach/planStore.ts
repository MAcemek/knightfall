import { useLiveQuery } from 'dexie-react-hooks';
import { db, KEYS } from '../../shared/db.ts';
import { setAnalysisPrefs } from '../../shared/analysis/index.ts';
import { getSettings, setSetting } from '../../shared/settings.ts';
import { sanitizePlan, type CoachPlan } from './planLogic.ts';
import { sanitizeActivity } from './stopRules.ts';

/** The plan in the local database. The rules are in planLogic.ts. */

/** The stored plan, cleaned. Read-only, so it is safe inside a live query. */
export async function readPlan(): Promise<CoachPlan | null> {
  const row = await db.kv.get(KEYS.coachPlan);
  return sanitizePlan(row?.value);
}

/** Live plan. Undefined while loading, null when there is none. */
export function usePlan(): CoachPlan | null | undefined {
  return useLiveQuery(readPlan, []);
}

/**
 * Saves the plan. Synced games belong to one username, so they are cleared when it changes. The rating history is never deleted: its rows carry the username. The username also goes to the
 * Game Review import box. The first plan ever saved turns the engine-off review on for slow games, unless it was already set.
 * Resolves to the plan as stored, or null when it was not valid.
 */
export async function savePlan(plan: CoachPlan): Promise<CoachPlan | null> {
  const clean = sanitizePlan(plan);
  if (!clean) return null;
  const had = await db.transaction('rw', db.kv, async () => {
    const [oldPlan, activity] = await Promise.all([db.kv.get(KEYS.coachPlan), db.kv.get(KEYS.coachActivity)]);
    const before = sanitizePlan(oldPlan?.value);
    await db.kv.put({ key: KEYS.coachPlan, value: clean });
    const user = clean.username.toLowerCase();
    const changed = (before?.username.toLowerCase() ?? '') !== user || (!!activity && sanitizeActivity(activity.value).user !== user);
    if (activity && changed) await db.kv.delete(KEYS.coachActivity);
    return before !== null;
  });
  if (clean.username) await setAnalysisPrefs({ chesscomUser: clean.username });
  if (!had && getSettings().selfReview === 'off') setSetting('selfReview', 'slow');
  return clean;
}

/** Removes the plan and the synced games. Ticks, rating history and stored games stay. */
export async function removePlan(): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    await db.kv.delete(KEYS.coachPlan);
    await db.kv.delete(KEYS.coachActivity);
  });
}
