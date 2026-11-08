import { BATTLE_MAX_STRIKES, BATTLE_REMATCH_WINDOW_MS, type BattleScore, type PlayerInfo, type ServerMessage } from '@knightfall/core';

/**
 * Puzzle Battle client state machine (pure). Server messages and local events go through
 * `battleReducer`; side effects (socket, sounds, persistence) live in useBattle.
 */

/** Shared with the server bot (packages/core protocol.ts) so bots' difficulty tracks what humans see. */
export { BATTLE_RAMP } from '@knightfall/core';
export const REMATCH_WINDOW_MS = BATTLE_REMATCH_WINDOW_MS;

export type Phase = 'lobby' | 'connecting' | 'searching' | 'matched' | 'playing' | 'ended';
export type RematchState = 'none' | 'requested' | 'offered' | 'unavailable';

export interface PlayedPuzzle {
  id: string;
  rating: number;
  solved: boolean;
}

export interface MatchInfo {
  roomId: string;
  seed: number;
  me: PlayerInfo;
  opponent: PlayerInfo;
  /** Server epoch ms; 0 until 'start' arrives. */
  startsAt: number;
  endsAt: number;
}

export interface EndInfo {
  result: 'win' | 'loss' | 'draw';
  reason: 'time' | 'strikes' | 'opponent-left' | 'resigned';
  you: BattleScore;
  opponent: BattleScore;
  ratingBefore: number;
  ratingAfter: number;
  endedAt: number;
}

export interface BattleState {
  phase: Phase;
  error: string | null;
  queuedAt: number;
  queuePosition: number;
  match: MatchInfo | null;
  me: BattleScore;
  opp: BattleScore;
  /** Bumps on every opponent progress change (drives pop animations). */
  oppTick: number;
  history: PlayedPuzzle[];
  end: EndInfo | null;
  rematch: RematchState;
}

export const initialBattleState: BattleState = {
  phase: 'lobby',
  error: null,
  queuedAt: 0,
  queuePosition: 0,
  match: null,
  me: { solved: 0, strikes: 0 },
  opp: { solved: 0, strikes: 0 },
  oppTick: 0,
  history: [],
  end: null,
  rematch: 'none',
};

export type BattleAction =
  | { type: 'connecting' }
  | { type: 'search-started'; at: number }
  | { type: 'cancel' }
  | { type: 'to-lobby'; error?: string | null }
  | { type: 'connection-lost' }
  | { type: 'server'; msg: ServerMessage; me: PlayerInfo }
  | { type: 'go' }
  | { type: 'my-result'; puzzle: { id: string; rating: number }; solved: boolean }
  | { type: 'ended'; end: EndInfo }
  | { type: 'rematch-requested' }
  | { type: 'rematch-expired' }
  | { type: 'clear-error' };

const inMatch = (p: Phase) => p === 'matched' || p === 'playing';

export function battleReducer(s: BattleState, a: BattleAction): BattleState {
  switch (a.type) {
    case 'connecting':
      return { ...s, phase: 'connecting', error: null };
    case 'search-started':
      return { ...s, phase: 'searching', queuedAt: a.at, queuePosition: 0, error: null, end: null, rematch: 'none' };
    case 'cancel':
      return s.phase === 'searching' || s.phase === 'connecting' ? { ...s, phase: 'lobby' } : s;
    case 'to-lobby':
      return { ...initialBattleState, error: a.error ?? null };
    case 'connection-lost':
      if (s.phase === 'ended') return { ...s, rematch: 'unavailable' };
      if (s.phase === 'lobby') return s;
      return { ...initialBattleState, error: inMatch(s.phase) ? 'Connection to the battle server was lost. The battle was abandoned.' : 'Lost connection to the battle server.' };
    case 'go':
      return s.phase === 'matched' ? { ...s, phase: 'playing' } : s;
    case 'my-result': {
      if (s.phase !== 'playing' || s.me.strikes >= BATTLE_MAX_STRIKES) return s;
      const me = a.solved ? { ...s.me, solved: s.me.solved + 1 } : { ...s.me, strikes: s.me.strikes + 1 };
      return { ...s, me, history: [...s.history, { ...a.puzzle, solved: a.solved }] };
    }
    case 'ended':
      return { ...s, phase: 'ended', end: a.end, me: a.end.you, opp: a.end.opponent, rematch: 'none' };
    case 'rematch-requested':
      return s.phase === 'ended' && s.rematch !== 'unavailable' ? { ...s, rematch: 'requested' } : s;
    case 'rematch-expired':
      return s.phase === 'ended' && s.rematch !== 'unavailable' ? { ...s, rematch: 'unavailable' } : s;
    case 'clear-error':
      return { ...s, error: null };
    case 'server':
      return onServer(s, a.msg, a.me);
  }
}

function onServer(s: BattleState, msg: ServerMessage, me: PlayerInfo): BattleState {
  switch (msg.type) {
    case 'queued':
      return s.phase === 'searching' ? { ...s, queuePosition: msg.position } : s;
    case 'matched':
      return {
        ...s,
        phase: 'matched',
        error: null,
        match: { roomId: msg.roomId, seed: msg.seed, me, opponent: msg.opponent, startsAt: 0, endsAt: 0 },
        me: { solved: 0, strikes: 0 },
        opp: { solved: 0, strikes: 0 },
        oppTick: 0,
        history: [],
        end: null,
        rematch: 'none',
      };
    case 'start':
      return s.match && s.phase === 'matched' ? { ...s, match: { ...s.match, startsAt: msg.startsAt, endsAt: msg.endsAt } } : s;
    case 'opponent-progress':
      if (!inMatch(s.phase)) return s;
      return { ...s, opp: { solved: msg.solved, strikes: msg.strikes }, oppTick: s.oppTick + 1 };
    case 'rematch-offered':
      return s.phase === 'ended' && s.rematch !== 'unavailable' ? { ...s, rematch: s.rematch === 'requested' ? 'requested' : 'offered' } : s;
    case 'opponent-left':
      return s.phase === 'ended' ? { ...s, rematch: 'unavailable' } : s;
    case 'error':
      if (s.phase === 'ended') return { ...s, rematch: s.rematch === 'requested' ? 'unavailable' : s.rematch };
      if (s.phase === 'searching' || s.phase === 'connecting') return { ...s, phase: 'lobby', error: msg.message };
      return s;
    default:
      // 'end' is handled by useBattle (needs persistence) and dispatched as 'ended'; 'pong' adjusts the clock.
      return s;
  }
}

/** Share of the tug-of-war bar that belongs to me (0..1). */
export function tugShare(me: number, opp: number): number {
  return (me + 1) / (me + opp + 2);
}

/** Elo score for a result. */
export const resultScore = (r: EndInfo['result']) => (r === 'win' ? 1 : r === 'draw' ? 0.5 : 0);
