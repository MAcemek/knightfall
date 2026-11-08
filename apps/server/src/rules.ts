import { BATTLE_MAX_STRIKES, type BattleScore } from '@knightfall/core';

/** Pure battle rules: progress validation, end conditions and results. Shared by Room and its tests. */

export type EndReason = 'time' | 'strikes' | 'opponent-left';
export type BattleResult = 'win' | 'loss' | 'draw';

export const emptyScore = (): BattleScore => ({ solved: 0, strikes: 0 });

export const isOut = (s: BattleScore) => s.strikes >= BATTLE_MAX_STRIKES;

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Validate a client's progress report against the stored score.
 * Returns the accepted new score, or null when the report must be ignored.
 */
export function acceptProgress(
  prev: BattleScore,
  report: { solved: unknown; strikes: unknown; index: unknown },
  now: number,
  startsAt: number,
): BattleScore | null {
  if (now < startsAt) return null;
  if (isOut(prev)) return null;
  const { solved, strikes, index } = report;
  if (!isCount(solved) || !isCount(strikes) || !isCount(index)) return null;
  if (solved < prev.solved || strikes < prev.strikes) return null;
  if (strikes > BATTLE_MAX_STRIKES) return null;
  const dSolved = solved - prev.solved;
  const dStrikes = strikes - prev.strikes;
  // One puzzle result per message: either +1 solved or +1 strike (or a harmless repeat).
  if (dSolved > 1 || dStrikes > 1 || dSolved + dStrikes > 1) return null;
  return { solved, strikes };
}

/**
 * Should the battle end now? `a` and `b` are the two players' scores.
 * - time is up
 * - both players struck out
 * - one player struck out and the other is already strictly ahead (nothing left to decide)
 */
export function endReason(a: BattleScore, b: BattleScore, now: number, endsAt: number): Exclude<EndReason, 'opponent-left'> | null {
  if (now >= endsAt) return 'time';
  const aOut = isOut(a);
  const bOut = isOut(b);
  if (aOut && bOut) return 'strikes';
  if (aOut && b.solved > a.solved) return 'strikes';
  if (bOut && a.solved > b.solved) return 'strikes';
  return null;
}

/** Result from the perspective of the player with score `me`. */
export function resultFor(me: BattleScore, opp: BattleScore): BattleResult {
  if (me.solved > opp.solved) return 'win';
  if (me.solved < opp.solved) return 'loss';
  return 'draw';
}
