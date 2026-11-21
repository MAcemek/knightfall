import { judgeRetry, type PositionEval, type Side } from '@knightfall/core';

/** State machine of "Retry": the user replays the position before a bad move. No React, no board. */

export type RetryPhase = 'ask' | 'wrong' | 'good' | 'best';

export interface RetryState {
  phase: RetryPhase;
  /** Wrong moves so far. */
  misses: number;
}

/** Wrong tries before the piece to move is highlighted. */
export const RETRY_HINT_AFTER = 2;

export type RetryVerdict = 'best' | 'good' | 'wrong';

export function retryStart(): RetryState {
  return { phase: 'ask', misses: 0 };
}

/** The user may move only while we are waiting for a move. */
export function retryCanMove(s: RetryState): boolean {
  return s.phase === 'ask';
}

/** Apply the verdict on the user's move. Ignored unless a move was expected. */
export function retryJudge(s: RetryState, verdict: RetryVerdict): RetryState {
  if (s.phase !== 'ask') return s;
  if (verdict === 'wrong') return { phase: 'wrong', misses: s.misses + 1 };
  return { ...s, phase: verdict };
}

/** After the short beat that shows a wrong move: back to waiting. */
export function retryResume(s: RetryState): RetryState {
  return s.phase === 'wrong' ? { ...s, phase: 'ask' } : s;
}

/** Whether the piece that should move is highlighted. */
export function retryHint(s: RetryState): boolean {
  return s.phase === 'ask' && s.misses >= RETRY_HINT_AFTER;
}

/** Retry is over (a right or acceptable move was played). */
export function retryFinished(s: RetryState): boolean {
  return s.phase === 'best' || s.phase === 'good';
}

export type RetryTone = 'ask' | 'bad' | 'good' | 'best';

/** Bubble text for the current state. */
export function retryMessage(s: RetryState, playedSan: string): { title: string; text: string; tone: RetryTone } {
  switch (s.phase) {
    case 'best':
      return { title: "That's it!", text: 'That is the engine’s top choice here.', tone: 'best' };
    case 'good':
      return { title: 'Good, but there’s a stronger move', text: 'Your move holds up. Press Show answer to see the best one.', tone: 'good' };
    case 'wrong':
      return { title: 'Not that one — try again', text: 'That move does not solve the problem.', tone: 'bad' };
    default:
      if (retryHint(s)) return { title: 'Find a better move', text: 'Hint: the highlighted piece is the one to move.', tone: 'ask' };
      return { title: 'Find a better move', text: `You played ${playedSan}. Play a stronger move on the board.`, tone: 'ask' };
  }
}

/** Judge a move against the stored engine lines of the position before the move. */
export function judgeRetryMove(evalBefore: PositionEval | undefined, uci: string, mover: Side): RetryVerdict {
  return evalBefore ? judgeRetry(evalBefore, uci, mover) : 'wrong';
}
