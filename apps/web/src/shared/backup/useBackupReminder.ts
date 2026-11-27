import { useLiveQuery } from 'dexie-react-hooks';
import { db, getKV, KEYS } from '../db.ts';
import { reminderText, shouldRemindBackup } from './reminderLogic.ts';

/** Text of the backup reminder, or null when none is due. Cheap: three counts and one key. */
export function useBackupReminder(): string | null {
  return (
    useLiveQuery(async () => {
      const [attempts, battles, plan, last] = await Promise.all([
        db.attempts.count(),
        db.battles.count(),
        getKV<unknown>(KEYS.coachPlan, null),
        getKV<string | null>(KEYS.lastBackupAt, null),
      ]);
      const now = Date.now();
      return shouldRemindBackup({ attempts, battles, coach: plan !== null }, last, now) ? reminderText(last, now) : null;
    }, []) ?? null
  );
}
