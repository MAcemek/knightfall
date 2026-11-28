/** Rules for the Home page: new vs returning player and the daily goal. No DOM, no database. */

/** Rush writes attempts; Battle and Daily do not, so all three counts decide. */
export function isReturning(c: { attempts: number; battles: number; dailies: number }): boolean {
  return c.attempts > 0 || c.battles > 0 || c.dailies > 0;
}

/** Midnight at the start of the device's local day, as epoch ms. */
export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Puzzles solved today. Attempts cover every mode that writes them (rated, rush, train, custom, review...).
 * Battles and the Daily write their own tables, not attempts, so adding them counts nothing twice.
 */
export function solvedToday(input: {
  attempts: readonly { solved: boolean; at: number }[];
  battles: readonly { at: number; you: { solved: number } }[];
  daily: { solved: boolean; at: number } | undefined;
  now: number;
}): number {
  const start = startOfLocalDay(input.now);
  const fromAttempts = input.attempts.filter((a) => a.solved && a.at >= start).length;
  const fromBattles = input.battles.filter((b) => b.at >= start).reduce((n, b) => n + Math.max(0, b.you.solved), 0);
  const fromDaily = input.daily && input.daily.solved && input.daily.at >= start ? 1 : 0;
  return fromAttempts + fromBattles + fromDaily;
}

/** Fraction of the goal done, clamped to 0..1; null when the goal is off (0). */
export function goalProgress(count: number, goal: number): number | null {
  if (!(goal > 0)) return null;
  return Math.min(1, Math.max(0, count / goal));
}
