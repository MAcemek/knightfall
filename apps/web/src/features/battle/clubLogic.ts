import type { ClubPhase, ClubPlayer, BattleSettings, ServerMessage } from '@knightfall/core';
import type { BattleRecord } from '../../shared/db.ts';

/** Club room rules (pure): the view state fed by `club-state`, ranking, wording and the history record. */

export interface ClubRoom {
  code: string;
  /** My id in `players`. */
  you: string;
  hostId: string;
  phase: ClubPhase;
  players: ClubPlayer[];
  settings: BattleSettings;
  seed?: number;
  startsAt?: number;
  endsAt?: number;
  /** False when I joined during a race and only watch until the next one. */
  participating: boolean;
}

export interface ClubUiState {
  room: ClubRoom | null;
  /** A create/join request that has not been answered yet. */
  pending: 'create' | 'join' | null;
  error: string | null;
  /** The connection dropped while I was in a room: the room stays on screen while the app joins it again. */
  reconnecting: boolean;
}

export const initialClubState: ClubUiState = { room: null, pending: null, error: null, reconnecting: false };

export type ClubAction =
  | { type: 'pending'; kind: 'create' | 'join' }
  | { type: 'server'; msg: ServerMessage }
  | { type: 'left' }
  /** A request that could not be sent or was never answered. */
  | { type: 'fail'; error: string }
  | { type: 'connection-lost' }
  /** The room could not be joined again after a reconnect (gone, full, or too late). */
  | { type: 'rejoin-failed' }
  | { type: 'clear-error' };

export function clubReducer(s: ClubUiState, a: ClubAction): ClubUiState {
  switch (a.type) {
    case 'pending':
      return s.pending || s.room ? s : { room: null, pending: a.kind, error: null, reconnecting: false };
    case 'fail':
      return { ...s, pending: null, error: a.error };
    case 'left':
      return s.room || s.pending || s.error ? initialClubState : s;
    case 'connection-lost':
      // In a room: keep it on screen and join again once the socket is back. A create/join in flight is just lost.
      if (s.room) return s.reconnecting ? s : { ...s, pending: null, reconnecting: true };
      return s.pending ? { ...initialClubState, error: CLUB_CLOSED_TEXT } : s;
    case 'rejoin-failed':
      return s.reconnecting ? { ...initialClubState, error: CLUB_CLOSED_TEXT } : s;
    case 'clear-error':
      return s.error ? { ...s, error: null } : s;
    case 'server': {
      const m = a.msg;
      if (m.type === 'club-error') return { room: s.room, pending: null, error: clubErrorText(m.reason), reconnecting: s.reconnecting };
      if (m.type !== 'club-state') return s;
      const prev = s.room && s.room.code === m.code ? s.room : null;
      const participating = m.phase === 'lobby' ? true : prev ? prev.participating : false;
      return {
        room: {
          code: m.code, you: m.you, hostId: m.hostId, phase: m.phase, players: m.players, settings: m.settings, participating,
          ...(m.seed !== undefined ? { seed: m.seed } : {}),
          ...(m.startsAt !== undefined ? { startsAt: m.startsAt } : {}),
          ...(m.endsAt !== undefined ? { endsAt: m.endsAt } : {}),
        },
        pending: null,
        error: null,
        reconnecting: false,
      };
    }
  }
}

const CLUB_CLOSED_TEXT = 'Lost connection to the battle server. The club room was closed for you.';

/** Text for a `club-error` reason; unknown reasons get a generic line. */
export function clubErrorText(reason: string): string {
  switch (reason) {
    case 'not-found':
    case 'invalid':
      return "That club room doesn't exist. Check the code.";
    case 'full':
      return 'That club room is full.';
    case 'busy':
      return "You can't join a club room while in a battle.";
    case 'not-host':
      return 'Only the host can do that.';
    case 'rate-limited':
      return 'Too many tries in a row. Wait a minute.';
    default:
      return reason.includes(' ') ? reason : 'Something went wrong with the club room. Try again.';
  }
}

export const isHost = (room: ClubRoom): boolean => room.hostId === room.you;

export interface RankedPlayer {
  player: ClubPlayer;
  /** 1-based; players level on score and strikes share a rank. At the end the server's place wins. */
  rank: number;
}

/** Players best first: by the server's place once known, otherwise most solved, then fewer strikes (join order breaks ties). */
export function rankPlayers(players: readonly ClubPlayer[]): RankedPlayer[] {
  const idx = new Map(players.map((p, i) => [p.id, i]));
  const sorted = [...players].sort((a, b) => {
    if (a.place !== undefined && b.place !== undefined && a.place !== b.place) return a.place - b.place;
    return b.solved - a.solved || a.strikes - b.strikes || idx.get(a.id)! - idx.get(b.id)!;
  });
  const out: RankedPlayer[] = [];
  sorted.forEach((p, i) => {
    const prev = out[i - 1];
    const same = prev && (p.place !== undefined ? prev.player.place === p.place : prev.player.solved === p.solved && prev.player.strikes === p.strikes);
    out.push({ player: p, rank: same ? prev.rank : i + 1 });
  });
  return out;
}

export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export const clubPlayer = (room: ClubRoom): ClubPlayer | undefined => room.players.find((p) => p.id === room.you);

export function myRank(room: ClubRoom): number {
  return rankPlayers(room.players).find((r) => r.player.id === room.you)?.rank ?? room.players.length;
}

/** Identity of one race of a room (the lobby has none). */
export const raceKey = (room: ClubRoom): string => `${room.code}:${room.startsAt ?? 0}`;

export const clubLink = (origin: string, code: string): string => `${origin}/battle?club=${code}`;

/** "Club race · 3rd of 12", for Recent battles. */
export const clubLabel = (club: { place: number; players: number }): string => `Club race · ${ordinal(club.place)} of ${club.players}`;

/** The history record for a finished race I took part in (null for spectators or unfinished races). */
export function clubRecord(room: ClubRoom, at: number): BattleRecord | null {
  if (room.phase !== 'ended' || !room.participating) return null;
  const me = clubPlayer(room);
  if (!me) return null;
  const ranked = rankPlayers(room.players);
  const place = ranked.find((r) => r.player.id === me.id)?.rank ?? room.players.length;
  const top = ranked.find((r) => r.player.id !== me.id)?.player;
  return {
    at,
    result: place === 1 ? 'win' : 'loss',
    reason: 'club',
    opponentName: `Club ${room.code}`,
    opponentRating: me.rating,
    you: { solved: me.solved, strikes: me.strikes },
    opponent: { solved: top?.solved ?? 0, strikes: top?.strikes ?? 0 },
    ratingBefore: me.rating,
    ratingAfter: me.rating,
    friendly: true,
    club: { place, players: room.players.length },
  };
}

/** A create/join the server never answers is given up on after this long. */
export const CLUB_REPLY_TIMEOUT_MS = 8000;
export const CLUB_OUTDATED_TEXT = 'Club rooms need a newer battle server. Try again in a minute.';
export const CLUB_NO_ANSWER_TEXT = "The battle server didn't answer. Try again.";

/** Why a create/join cannot be sent to this server (an older one drops club messages), or null when it can. */
export function clubBlockedText(status: string, serverCaps: readonly string[]): string | null {
  return status === 'outdated' || !serverCaps.includes('club') ? CLUB_OUTDATED_TEXT : null;
}
