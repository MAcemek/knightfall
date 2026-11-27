/** When to nudge the player to save a backup file. Pure. */

export const REMINDER_DAYS = 14;
export const REMINDER_MIN_ATTEMPTS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProgressSize {
  attempts: number;
  battles: number;
  /** A coach plan exists. */
  coach: boolean;
}

export function hasMeaningfulProgress(p: ProgressSize): boolean {
  return p.attempts >= REMINDER_MIN_ATTEMPTS || p.battles > 0 || p.coach;
}

/** lastBackupAt is an ISO string or null/undefined when no backup was ever saved. */
export function shouldRemindBackup(p: ProgressSize, lastBackupAt: string | null | undefined, now: number): boolean {
  if (!hasMeaningfulProgress(p)) return false;
  if (!lastBackupAt) return true;
  const t = Date.parse(lastBackupAt);
  if (Number.isNaN(t)) return true;
  return now - t > REMINDER_DAYS * DAY_MS;
}

export function reminderText(lastBackupAt: string | null | undefined, now: number): string {
  const t = lastBackupAt ? Date.parse(lastBackupAt) : NaN;
  if (Number.isNaN(t)) return 'Your progress lives only in this browser and has never been backed up.';
  const days = Math.max(1, Math.floor((now - t) / DAY_MS));
  return `Your last backup was ${days} days ago. Your progress lives only in this browser.`;
}
