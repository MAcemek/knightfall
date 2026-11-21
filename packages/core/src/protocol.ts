/**
 * Puzzle Battle WebSocket protocol (JSON messages over /ws).
 * The server is authoritative for matchmaking, the clock, and the result.
 */

export const BATTLE_DURATION_MS = 3 * 60 * 1000;
export const BATTLE_COUNTDOWN_MS = 3000;
export const BATTLE_MAX_STRIKES = 3;
/** Difficulty ramp (rampRating start/step) of the shared Battle puzzle sequence. Client and server bot must agree. */
export const BATTLE_RAMP = { start: 500, step: 45 } as const;
/** Both players must send 'rematch' within this window after the end. */
export const BATTLE_REMATCH_WINDOW_MS = 20_000;
/** A friend challenge stays open this long before it expires. */
export const BATTLE_CHALLENGE_TTL_MS = 60_000;
/**
 * Sent as a plain `error` to a session whose friend code was taken over by another tab of the same browser.
 * Old clients show it like any error; new clients match it to disable friend challenges in that tab.
 */
export const FRIEND_MOVED_MESSAGE = 'Friend challenges moved to another tab';

export interface PlayerInfo {
  name: string;
  rating: number;
}

export interface BattleScore {
  solved: number;
  strikes: number;
}

export type ClientMessage =
  | { type: 'queue'; player: PlayerInfo }
  | { type: 'cancel' }
  /** Sent after every puzzle result. `index` is the puzzle index just finished. */
  | { type: 'progress'; index: number; solved: number; strikes: number }
  | { type: 'rematch' }
  /** Leave the current room. Mid-game the opponent wins ('opponent-left'); the leaver gets no 'end' message. */
  | { type: 'leave' }
  /** End the battle early as the winner: allowed vs a bot that is out of strikes while you are ahead. */
  | { type: 'claim' }
  | { type: 'ping' }
  /** Sent on every (re)connect and when name/rating changes. Old clients never send it. */
  | { type: 'hello'; player: PlayerInfo; code?: string; token?: string }
  | { type: 'challenge'; code: string }
  | { type: 'challenge-cancel' }
  | { type: 'challenge-respond'; id: string; accept: boolean };

export type ChallengeStatus =
  | 'sent'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'offline'
  | 'busy'
  | 'self'
  | 'invalid'
  | 'rate-limited'
  | 'unavailable';

export type ServerMessage =
  | { type: 'queued'; position: number }
  | { type: 'matched'; roomId: string; seed: number; opponent: PlayerInfo; friendly?: true }
  /** startsAt/endsAt are server epoch ms; clients use serverNow to compute a clock offset. */
  | { type: 'start'; startsAt: number; endsAt: number; serverNow: number }
  | { type: 'opponent-progress'; solved: number; strikes: number; index: number }
  | {
      type: 'end';
      result: 'win' | 'loss' | 'draw';
      reason: 'time' | 'strikes' | 'opponent-left' | 'claimed';
      you: BattleScore;
      opponent: BattleScore;
    }
  | { type: 'rematch-offered' }
  | { type: 'opponent-left' }
  | { type: 'error'; message: string }
  | { type: 'pong'; serverNow: number }
  /** Reply to 'hello' (only clients that sent hello get the messages below). */
  | { type: 'welcome'; code: string; token: string }
  | { type: 'challenge-status'; status: ChallengeStatus; name?: string; expiresAt?: number; serverNow?: number }
  | { type: 'challenge-received'; id: string; from: PlayerInfo; expiresAt: number; serverNow: number }
  | { type: 'challenge-withdrawn'; id: string };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decode<T extends ClientMessage | ServerMessage>(raw: string): T | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v.type === 'string' ? (v as T) : null;
  } catch {
    return null;
  }
}
