import { BATTLE_CODE_LENGTH, formatCode, isValidCode, normalizeCode, type BattleSettings, type ChallengeStatus, type PlayerInfo } from '@knightfall/core';

/**
 * Friend-challenge rules (pure): the outgoing challenge I sent, the invitations I received, countdowns on the
 * server clock, and the text for every outcome. Side effects (socket, sound, navigation) live in store.ts.
 */

/** A sent challenge with no acknowledgement from the server after this long is given up on. */
export const SENDING_TIMEOUT_MS = 8000;
/** The server expires challenges itself; this is the local fallback if that message never arrives. */
export const EXPIRY_GRACE_MS = 3000;
/** The server keeps at most this many invitations per player; the client mirrors it. */
export const MAX_INCOMING = 3;

/** Outcomes: what the server can say, plus the ones decided on this device (battle server not usable). */
export type ChallengeResult = Exclude<ChallengeStatus, 'sent'> | 'server-offline' | 'server-waking' | 'server-connecting' | 'server-outdated' | 'server-moved';

export type OutgoingState =
  | { kind: 'idle' }
  /** `at` is local epoch ms (Date.now) of sending. */
  | { kind: 'sending'; code: string; at: number }
  /** `expiresAt` is server epoch ms. */
  | { kind: 'waiting'; code: string; name: string | null; expiresAt: number }
  | { kind: 'result'; status: ChallengeResult; name: string | null };

export const idleOutgoing: OutgoingState = { kind: 'idle' };

export type OutgoingAction =
  | { type: 'send'; code: string; at: number }
  | { type: 'fail'; status: ChallengeResult }
  | { type: 'status'; status: ChallengeStatus; name?: string; expiresAt?: number }
  | { type: 'cancel' }
  | { type: 'dismiss' }
  | { type: 'matched' }
  | { type: 'connection-lost' }
  /** `serverNow` is the server-clock estimate, `localNow` is Date.now(). */
  | { type: 'tick'; serverNow: number; localNow: number };

export function outgoingReducer(s: OutgoingState, a: OutgoingAction): OutgoingState {
  switch (a.type) {
    case 'send':
      return { kind: 'sending', code: a.code, at: a.at };
    case 'fail':
      return { kind: 'result', status: a.status, name: null };
    case 'status': {
      // Stray statuses (such as the echo of my own cancel) are ignored unless a challenge is in flight.
      if (s.kind !== 'sending' && s.kind !== 'waiting') return s;
      if (a.status === 'sent') {
        return s.kind === 'sending' && a.expiresAt !== undefined
          ? { kind: 'waiting', code: s.code, name: a.name ?? null, expiresAt: a.expiresAt }
          : s;
      }
      return { kind: 'result', status: a.status, name: a.name ?? (s.kind === 'waiting' ? s.name : null) };
    }
    case 'cancel':
    case 'dismiss':
    case 'matched':
      return s.kind === 'idle' ? s : idleOutgoing;
    case 'connection-lost':
      return s.kind === 'sending' || s.kind === 'waiting'
        ? { kind: 'result', status: 'server-offline', name: s.kind === 'waiting' ? s.name : null }
        : s;
    case 'tick':
      if (s.kind === 'sending' && a.localNow - s.at > SENDING_TIMEOUT_MS) return { kind: 'result', status: 'unavailable', name: null };
      if (s.kind === 'waiting' && a.serverNow >= s.expiresAt + EXPIRY_GRACE_MS) return { kind: 'result', status: 'expired', name: s.name };
      return s;
  }
}

export interface Invite {
  id: string;
  from: PlayerInfo;
  /** Server epoch ms. */
  expiresAt: number;
  /** Options the challenger chose (absent on a plain challenge). */
  settings?: BattleSettings;
  series?: 1 | 3;
}

export type IncomingAction =
  | { type: 'received'; invite: Invite }
  | { type: 'withdrawn'; id: string }
  | { type: 'respond'; id: string }
  | { type: 'clear' }
  | { type: 'tick'; serverNow: number };

export function incomingReducer(list: readonly Invite[], a: IncomingAction): readonly Invite[] {
  switch (a.type) {
    case 'received': {
      if (list.some((i) => i.id === a.invite.id)) return list;
      return [...list, a.invite].slice(-MAX_INCOMING);
    }
    case 'withdrawn':
    case 'respond':
      return list.some((i) => i.id === a.id) ? list.filter((i) => i.id !== a.id) : list;
    case 'clear':
      return list.length ? [] : list;
    case 'tick': {
      const live = list.filter((i) => i.expiresAt > a.serverNow);
      return live.length === list.length ? list : live;
    }
  }
}

export type InviteDisplay = 'none' | 'banner' | 'card';

/**
 * How to show the top invitation. Never during a live battle. During timed play (a Rush run) only a slim
 * banner, unless the player tapped it open (`expanded`).
 */
export function inviteDisplay(o: { invite: Invite | null; battleLive: boolean; timedPlay: boolean; expanded: boolean }): InviteDisplay {
  if (!o.invite || o.battleLive) return 'none';
  return o.timedPlay && !o.expanded ? 'banner' : 'card';
}

/** The invitation to show first: the one that runs out soonest. */
export function topInvite(list: readonly Invite[]): Invite | null {
  let best: Invite | null = null;
  for (const i of list) if (!best || i.expiresAt < best.expiresAt) best = i;
  return best;
}

/** Whole seconds left on the server clock, never negative. */
export function secondsLeft(expiresAt: number, serverNow: number): number {
  return Math.max(0, Math.ceil((expiresAt - serverNow) / 1000));
}

/** m:ss for a number of seconds. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Live formatting for the code box: uppercase letters and digits only, at most 6, grouped as XXX-XXX. */
export function formatCodeInput(raw: string): string {
  return formatCode(normalizeCode(raw).slice(0, BATTLE_CODE_LENGTH));
}

/** Why a typed code cannot be sent yet, or null when it is ready. */
export function codeProblem(raw: string): string | null {
  const code = normalizeCode(raw);
  if (code.length < BATTLE_CODE_LENGTH) return `Codes have ${BATTLE_CODE_LENGTH} characters.`;
  if (!isValidCode(code)) return 'That code has a character codes never use (0, O, 1, I or L).';
  return null;
}

/** Shown in the friend card when another tab of this browser holds the friend code. */
export const MOVED_TEXT = 'Friend challenges are active in another tab.';

export type MessageTone = 'info' | 'bad';

/** Text for a finished or in-flight outgoing challenge. Null while idle. */
export function outgoingMessage(s: OutgoingState, serverNow = 0): { tone: MessageTone; text: string } | null {
  switch (s.kind) {
    case 'idle':
      return null;
    case 'sending':
      return { tone: 'info', text: 'Sending challenge…' };
    case 'waiting':
      return { tone: 'info', text: `Waiting for ${s.name ?? 'your friend'}… ${formatCountdown(secondsLeft(s.expiresAt, serverNow))}` };
    case 'result':
      return { tone: 'bad', text: resultText(s.status, s.name) };
  }
}

export function resultText(status: ChallengeResult, name: string | null): string {
  const who = name ?? 'That player';
  switch (status) {
    case 'declined':
      return `${who} declined your challenge.`;
    case 'expired':
      return `${who} didn't answer in time. Try again.`;
    case 'cancelled':
      return 'Challenge cancelled.';
    case 'offline':
      return `${who} is offline right now. Ask them to open Knightfall and try again.`;
    case 'busy':
      return `${who} is in a battle right now. Try again in a minute.`;
    case 'self':
      return "That's your own code. Send it to a friend instead.";
    case 'invalid':
      return "That code isn't valid. Check it and try again.";
    case 'rate-limited':
      return 'Too many challenges in a row. Wait a minute and try again.';
    case 'outdated':
      return 'They need to reload Knightfall to play with custom settings.';
    case 'unavailable':
      return `${who} just became unavailable. Try again in a moment.`;
    case 'server-offline':
      return 'The battle server is offline right now. Try again in a minute.';
    case 'server-waking':
      return 'The battle server is waking up. Try again in a few seconds.';
    case 'server-connecting':
      return 'Still connecting to the battle server. Try again in a moment.';
    case 'server-outdated':
      return 'Battle server is updating, try again in a minute.';
    case 'server-moved':
      return MOVED_TEXT;
  }
}
