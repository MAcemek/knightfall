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
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'queued'; position: number }
  | { type: 'matched'; roomId: string; seed: number; opponent: PlayerInfo }
  /** startsAt/endsAt are server epoch ms; clients use serverNow to compute a clock offset. */
  | { type: 'start'; startsAt: number; endsAt: number; serverNow: number }
  | { type: 'opponent-progress'; solved: number; strikes: number; index: number }
  | {
      type: 'end';
      result: 'win' | 'loss' | 'draw';
      reason: 'time' | 'strikes' | 'opponent-left';
      you: BattleScore;
      opponent: BattleScore;
    }
  | { type: 'rematch-offered' }
  | { type: 'opponent-left' }
  | { type: 'error'; message: string }
  | { type: 'pong'; serverNow: number };

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
