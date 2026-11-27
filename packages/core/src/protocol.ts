/**
 * Puzzle Battle WebSocket protocol (JSON messages over /ws).
 * The server is authoritative for matchmaking, the clock, and the result.
 */

export const BATTLE_DURATION_MS = 180_000;
export const BATTLE_COUNTDOWN_MS = 3000;
export const BATTLE_MAX_STRIKES = 3;
/** Difficulty ramp (rampRating start/step) of the shared Battle puzzle sequence. Client and server bot must agree. */
export const BATTLE_RAMP = { start: 500, step: 45 } as const;
export type BattleLevel = 'easier' | 'normal' | 'harder';
/** Ramp per difficulty level. 'normal' is BATTLE_RAMP. */
export const BATTLE_LEVEL_RAMP: Record<BattleLevel, { start: number; step: number }> = {
  easier: { start: 350, step: 45 },
  normal: BATTLE_RAMP,
  harder: { start: 750, step: 45 },
};
/** Ramp for a level; undefined or unknown values (old clients, junk) get the normal ramp. */
export function rampFor(level?: string): { start: number; step: number } {
  return level !== undefined && Object.hasOwn(BATTLE_LEVEL_RAMP, level) ? BATTLE_LEVEL_RAMP[level as BattleLevel] : BATTLE_RAMP;
}
/** Friend battle options chosen by the challenger. */
export interface BattleSettings {
  durationMs: 60_000 | 180_000 | 300_000;
  level: BattleLevel;
}
export const DEFAULT_BATTLE_SETTINGS: BattleSettings = { durationMs: BATTLE_DURATION_MS, level: 'normal' };
/** Best-of series state from one player's side. Points: 1 per win, 0.5 per draw. */
export interface SeriesInfo {
  length: 1 | 3;
  /** 1-based number of the game being played. */
  game: number;
  me: number;
  opp: number;
}
/** Capabilities a client announces in `hello`. */
export const CLIENT_CAPS = ['settings', 'club', 'reconnect'] as const;
/**
 * Features this server supports, announced in `welcome` (an older server sends none).
 * 'reconnect': a 1v1 seat is held for BATTLE_RECONNECT_MS after a socket drop, a `hello` with `resume` takes it
 * back, and a club member who joins again with the same friend code gets their place back.
 */
export const SERVER_CAPS = ['settings', 'club', 'reconnect'] as const;
/** How long a dropped player's seat in a 1v1 battle is held before the opponent wins. */
export const BATTLE_RECONNECT_MS = 15_000;
export const CLUB_MAX_PLAYERS = 30;
/** A club room with no activity this long is closed. */
export const CLUB_IDLE_MS = 30 * 60 * 1000;
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

export interface ClubPlayer {
  id: string;
  name: string;
  rating: number;
  solved: number;
  strikes: number;
  out: boolean;
  connected: boolean;
  place?: number;
}

export type ClubPhase = 'lobby' | 'countdown' | 'playing' | 'ended';

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
  | { type: 'hello'; player: PlayerInfo; code?: string; token?: string; caps?: string[]; /** Room id of a battle this client is trying to get back into after a drop (needs the 'reconnect' cap). */ resume?: string }
  | { type: 'challenge'; code: string; settings?: BattleSettings; series?: 1 | 3 }
  | { type: 'challenge-cancel' }
  | { type: 'challenge-respond'; id: string; accept: boolean }
  | { type: 'club-create'; settings?: BattleSettings }
  | { type: 'club-join'; code: string }
  | { type: 'club-leave' }
  /** Host only. */
  | { type: 'club-start' }
  /** Host only: back to the lobby with scores reset. */
  | { type: 'club-new-race' };

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
  | 'unavailable'
  /** The target's app does not support battle settings yet. */
  | 'outdated';

export type ServerMessage =
  | { type: 'queued'; position: number }
  | {
      type: 'matched';
      roomId: string;
      seed: number;
      opponent: PlayerInfo;
      friendly?: true;
      /** Friend code of the opponent (friendly rooms only). */
      opponentCode?: string;
      settings?: BattleSettings;
      series?: SeriesInfo;
      /** Only when a dropped player takes their seat back: the scores of both sides right now. */
      resume?: { me: BattleScore; opp: BattleScore };
    }
  /** startsAt/endsAt are server epoch ms; clients use serverNow to compute a clock offset. */
  | { type: 'start'; startsAt: number; endsAt: number; serverNow: number }
  | { type: 'opponent-progress'; solved: number; strikes: number; index: number }
  /** Only to clients that announced 'reconnect': the opponent's connection dropped, their seat is held for `graceMs`. */
  | { type: 'opponent-away'; graceMs: number }
  /** The opponent is connected again. */
  | { type: 'opponent-back' }
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
  | { type: 'welcome'; code: string; token: string; caps?: string[] }
  | { type: 'challenge-status'; status: ChallengeStatus; name?: string; expiresAt?: number; serverNow?: number }
  | { type: 'challenge-received'; id: string; from: PlayerInfo; expiresAt: number; serverNow: number; settings?: BattleSettings; series?: 1 | 3 }
  | { type: 'challenge-withdrawn'; id: string }
  | {
      type: 'club-state';
      code: string;
      /** The receiving player's own id in `players`. */
      you: string;
      hostId: string;
      phase: ClubPhase;
      players: ClubPlayer[];
      settings: BattleSettings;
      seed?: number;
      startsAt?: number;
      endsAt?: number;
      serverNow: number;
    }
  | { type: 'club-error'; reason: string };

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
