import { BATTLE_MAX_STRIKES, BATTLE_REMATCH_WINDOW_MS, eloUpdate, type BattleScore, type BattleSettings, type PlayerInfo, type SeriesInfo, type ServerMessage } from '@knightfall/core';

/**
 * Puzzle Battle client state machine (pure). Server messages and local events go through
 * `battleReducer`; side effects (socket, sounds, persistence) live in shared/battle/store.ts.
 */

/** Shared with the server bot (packages/core protocol.ts) so bots' difficulty tracks what humans see. */
export { BATTLE_RAMP } from '@knightfall/core';
export const REMATCH_WINDOW_MS = BATTLE_REMATCH_WINDOW_MS;
/** The server starts the next game of an undecided series this long after a game ends. */
export const SERIES_NEXT_GAME_MS = 6000;

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
  /** Friend challenge: casual, no rating change. Sticks to rematches. */
  friendly?: boolean;
  /** Friend code of the opponent (friendly games only). */
  opponentCode?: string;
  settings?: BattleSettings;
  /** Best-of-3 state before this game. */
  series?: SeriesInfo;
}

export interface EndInfo {
  result: 'win' | 'loss' | 'draw';
  reason: 'time' | 'strikes' | 'opponent-left' | 'claimed' | 'resigned';
  you: BattleScore;
  opponent: BattleScore;
  ratingBefore: number;
  ratingAfter: number;
  endedAt: number;
}

export interface BattleState {
  phase: Phase;
  error: string | null;
  /** When the current connection attempt started (a sleeping hosted server can take a while to wake). */
  connectingSince: number;
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
  connectingSince: 0,
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
  | { type: 'connecting'; at?: number }
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
      return { ...s, phase: 'connecting', error: null, connectingSince: a.at ?? Date.now() };
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
        match: { roomId: msg.roomId, seed: msg.seed, me, opponent: msg.opponent, startsAt: 0, endsAt: 0, ...(msg.friendly ? { friendly: true } : {}), ...(msg.opponentCode ? { opponentCode: msg.opponentCode } : {}), ...(msg.settings ? { settings: msg.settings } : {}), ...(msg.series ? { series: msg.series } : {}) },
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
      // 'end' is handled by the battle store (needs persistence) and dispatched as 'ended'; 'pong' adjusts the clock.
      return s;
  }
}

/** Share of the tug-of-war bar that belongs to me (0..1). */
export function tugShare(me: number, opp: number): number {
  return (me + 1) / (me + opp + 2);
}

/** Elo score for a result. */
export const resultScore = (r: EndInfo['result']) => (r === 'win' ? 1 : r === 'draw' ? 0.5 : 0);

/** Rating after a battle: friendly (casual) battles never move it. */
export function ratingAfterBattle(match: Pick<MatchInfo, 'me' | 'opponent' | 'friendly'>, result: EndInfo['result']): number {
  return match.friendly ? match.me.rating : eloUpdate(match.me.rating, match.opponent.rating, resultScore(result));
}

/** A best-of-3 after one more game: points (1 per win, 0.5 per draw) and whether it is settled. */
export function seriesAfter(series: SeriesInfo, result: EndInfo['result'], reason: EndInfo['reason']): SeriesInfo & { over: boolean } {
  const me = series.me + (result === 'win' ? 1 : result === 'draw' ? 0.5 : 0);
  const opp = series.opp + (result === 'loss' ? 1 : result === 'draw' ? 0.5 : 0);
  const left = reason === 'opponent-left' || reason === 'resigned';
  return { ...series, me, opp, over: left || me >= 2 || opp >= 2 || series.game >= series.length };
}

/** Intro-card line: "Same puzzles. Three minutes. Three strikes." plus the game number in a best-of-3. */
export function introTagline(settings?: BattleSettings, series?: SeriesInfo): string {
  const ms = settings?.durationMs;
  const word = ms === 60_000 ? 'One minute' : ms === 300_000 ? 'Five minutes' : 'Three minutes';
  const game = series && series.length === 3 ? ` Game ${series.game} of 3.` : '';
  return `Same puzzles. ${word}. Three strikes.${game}`;
}

/** Resign-modal body text. */
export function resignText(friendly: boolean | undefined, series?: SeriesInfo): string {
  if (series?.length === 3) return 'Your opponent takes the win, and this ends the whole series. Casual, so your battle rating stays the same.';
  return friendly
    ? 'Your opponent takes the win. This is a casual battle, so your battle rating stays the same.'
    : 'Your opponent takes the win and your battle rating drops.';
}

/** End-screen line for a series. `nextIn` is whole seconds until the next game starts. */
export function seriesText(s: SeriesInfo & { over: boolean }, reason: EndInfo['reason'], nextIn: number): string {
  const score = `${s.me}–${s.opp}`;
  if (reason === 'opponent-left') return `Your opponent left · series ended ${score}`;
  if (reason === 'resigned') return `You left the series at ${score}`;
  if (s.over) return s.me > s.opp ? `You won the series ${score}` : s.me < s.opp ? `You lost the series ${score}` : `Series drawn ${score}`;
  const lead = s.me > s.opp ? `You lead ${score}` : s.me < s.opp ? `Opponent leads ${score}` : `Tied ${score}`;
  return `Game ${s.game} of ${s.length} · ${lead} · next game in ${Math.max(0, nextIn)}…`;
}
