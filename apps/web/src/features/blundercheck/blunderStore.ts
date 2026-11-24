import { useLiveQuery } from 'dexie-react-hooks';
import { db, KEYS } from '../../shared/db.ts';
import { dayKeyOf } from '../../shared/localDate.ts';
import { addOutcome, sanitizeTotals, type BlunderTotals, type Outcome } from './blunderLogic.ts';

/** Daily Blunder check totals in the local database. */

/** The stored totals, cleaned. Read-only, so it is safe inside a live query. */
export async function readBlunderTotals(): Promise<BlunderTotals> {
  const row = await db.kv.get(KEYS.blunderCheck);
  return sanitizeTotals(row?.value);
}

/** Live totals; undefined while loading. */
export function useBlunderTotals(): BlunderTotals | undefined {
  return useLiveQuery(readBlunderTotals, []);
}

/** Adds one judged position to today's totals. The read and the write share one transaction, so two quick saves never lose one. */
export async function recordOutcome(outcome: Outcome, now = Date.now()): Promise<void> {
  const date = dayKeyOf(now);
  await db.transaction('rw', db.kv, async () => {
    const row = await db.kv.get(KEYS.blunderCheck);
    await db.kv.put({ key: KEYS.blunderCheck, value: addOutcome(sanitizeTotals(row?.value), date, outcome) });
  });
}
