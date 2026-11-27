import { useSyncExternalStore } from 'react';
import { BATTLE_RECONNECT_MS, DEFAULT_BATTLE_SETTINGS, FRIEND_MOVED_MESSAGE, isValidCode, normalizeCode, type BattleScore, type BattleSettings } from '@knightfall/core';
import { db, defaults, getKV, KEYS, setKV, type BattleRecord } from '../db.ts';
import { getPlayerName } from '../profile.ts';
import { toast } from '../toast.tsx';
import {
  battleReducer, initialBattleState, missingProgress, ratingAfterBattle, seriesAfter,
  type BattleAction, type BattleState, type EndInfo, type ProgressReport,
} from '../../features/battle/battleState.ts';
import { challengeExtras, type Series } from '../../features/battle/friendSettings.ts';
import { recordOpponentResult, removeOpponent, sanitizeRecent, upsertOpponent, type RecentOpponent } from '../../features/battle/recentOpponents.ts';
import * as conn from './connection.ts';
import { serverSupports } from './connectionLogic.ts';
import {
  idleOutgoing, incomingReducer, outgoingReducer,
  type ChallengeResult, type IncomingAction, type Invite, type OutgoingAction, type OutgoingState,
} from './challengeLogic.ts';

/**
 * Module store for Puzzle Battle and friend challenges. It lives outside React and is driven by the shared
 * socket (connection.ts), so a `matched`/`start` that follows an Accept from another page is never lost.
 * `battleReducer` stays the single source of the rules; this file adds the side effects (socket sends,
 * persistence, timers). `useBattle` is a thin hook over it.
 */

// ---- battle state -------------------------------------------------------------------------------------------

let state: BattleState = initialBattleState;
const battleListeners = new Set<() => void>();
let savedRoom: string | null = null;
let searchGen = 0;

/** Gives up on a dropped battle when the server's grace is over. */
let graceTimer: ReturnType<typeof setTimeout> | null = null;
/** Results to send again after a reconnect, one every REPLAY_GAP_MS (the server wants a gap between a player's results). */
let replayQueue: ProgressReport[] = [];
let replayTimer: ReturnType<typeof setTimeout> | null = null;
/** The last server's `welcome` announced the 'reconnect' capability: a dropped battle is worth holding on to. */
let serverReconnects = false;
const REPLAY_GAP_MS = 400;

function dispatch(a: BattleAction): void {
  const next = battleReducer(state, a);
  if (next === state) return;
  state = next;
  if (!state.reconnectingSince && graceTimer) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
  if (state.phase !== 'playing' && state.phase !== 'matched') stopReplay();
  battleListeners.forEach((fn) => fn());
}

function stopReplay(): void {
  replayQueue = [];
  if (replayTimer) clearTimeout(replayTimer);
  replayTimer = null;
}

/** Send the queued results one by one, spaced out. */
function flushReplay(roomId: string): void {
  if (replayTimer || state.match?.roomId !== roomId) return;
  const next = replayQueue.shift();
  if (!next) return;
  if (!state.reconnectingSince) conn.send({ type: 'progress', ...next });
  else replayQueue.unshift(next);
  if (replayQueue.length) {
    replayTimer = setTimeout(() => {
      replayTimer = null;
      flushReplay(roomId);
    }, REPLAY_GAP_MS);
  }
}

/** The connection dropped mid-battle: hold the match for the server's grace, then fall back to abandoning it. */
function holdBattle(): void {
  dispatch({ type: 'reconnecting', at: Date.now() });
  if (!state.reconnectingSince || graceTimer) return;
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (state.reconnectingSince) dispatch({ type: 'connection-lost' });
  }, BATTLE_RECONNECT_MS);
}

export const getBattleState = (): BattleState => state;

function subscribeBattle(fn: () => void): () => void {
  battleListeners.add(fn);
  return () => {
    battleListeners.delete(fn);
  };
}

export function useBattleState(): BattleState {
  return useSyncExternalStore(subscribeBattle, getBattleState, getBattleState);
}

/** Compute the rating (none for casual battles), persist the record and move to the end screen. Idempotent per room. */
function finish(raw: { result: EndInfo['result']; reason: EndInfo['reason']; you: BattleScore; opponent: BattleScore }, rematchClosed = false): void {
  const match = state.match;
  if (!match || savedRoom === match.roomId) return;
  savedRoom = match.roomId;
  const friendly = match.friendly === true;
  const ratingBefore = match.me.rating;
  const ratingAfter = ratingAfterBattle(match, raw.result);
  if (!friendly) conn.setPlayer({ ...conn.getPlayer(), rating: ratingAfter });
  const end: EndInfo = { ...raw, ratingBefore, ratingAfter, endedAt: Date.now() };
  dispatch({ type: 'ended', end });
  if (rematchClosed) dispatch({ type: 'rematch-expired' });
  const record: BattleRecord = {
    at: Date.now(),
    result: raw.result,
    reason: raw.reason,
    opponentName: match.opponent.name,
    opponentRating: match.opponent.rating,
    you: { ...raw.you },
    opponent: { ...raw.opponent },
    ratingBefore,
    ratingAfter,
    ...(friendly ? { friendly: true } : {}),
    ...(match.opponentCode ? { opponentCode: match.opponentCode } : {}),
    ...(match.settings ? { settings: match.settings } : {}),
    ...(match.series ? { series: seriesAfter(match.series, raw.result, raw.reason) } : {}),
  };
  if (friendly && match.opponentCode) updateRecent((l) => recordOpponentResult(l, match.opponentCode!, raw.result));
  const writes: Promise<unknown>[] = [db.battles.add(record)];
  if (!friendly) writes.push(setKV(KEYS.battleRating, ratingAfter));
  void Promise.all(writes).catch((e) => console.error('Failed to save battle', e));
}

// ---- recent opponents ----------------------------------------------------------------------------------------

let recentQueue: Promise<unknown> = Promise.resolve();

/** Read-modify-write of the stored friend list, one at a time so quick updates never overwrite each other. */
function updateRecent(fn: (list: RecentOpponent[]) => RecentOpponent[]): void {
  recentQueue = recentQueue
    .then(async () => setKV(KEYS.recentOpponents, fn(sanitizeRecent(await getKV<unknown>(KEYS.recentOpponents, [])))))
    .catch((e) => console.error('Failed to save recent opponents', e));
}

export const forgetOpponent = (code: string): void => updateRecent((l) => removeOpponent(l, code));

export function findOpponent(): void {
  const phase = state.phase;
  if (phase !== 'lobby' && phase !== 'ended') return;
  const gen = ++searchGen;
  // Leaving the post-game screen: the server detaches us from the old room when we queue again.
  dispatch({ type: 'connecting' });
  void (async () => {
    const [name, rating] = await Promise.all([getPlayerName(), getKV<number>(KEYS.battleRating, defaults.battleRating)]);
    const me = { name, rating };
    conn.setPlayer(me);
    try {
      await conn.whenOpen();
    } catch {
      if (gen !== searchGen) return; // cancelled while connecting
      dispatch({ type: 'to-lobby', error: conn.OFFLINE_MESSAGE });
      return;
    }
    if (gen !== searchGen) return; // cancelled while connecting
    dispatch({ type: 'search-started', at: Date.now() });
    conn.send({ type: 'queue', player: me });
  })();
}

export function cancelSearch(): void {
  searchGen++;
  conn.send({ type: 'cancel' });
  dispatch({ type: 'cancel' });
}

export function reportResult(puzzle: { id: string; rating: number }, solved: boolean): void {
  const s = state;
  if (s.phase !== 'playing') return;
  const index = s.history.length;
  const solvedN = s.me.solved + (solved ? 1 : 0);
  const strikes = s.me.strikes + (solved ? 0 : 1);
  dispatch({ type: 'my-result', puzzle, solved });
  const report = { index, solved: solvedN, strikes };
  // While the connection is down the finished puzzles are sent after the reconnect, from the history. While
  // earlier ones are still being sent again, this one waits its turn.
  if (state.reconnectingSince) return;
  if (replayQueue.length || replayTimer) {
    replayQueue.push(report);
    return;
  }
  conn.send({ type: 'progress', ...report });
}

export function rematch(): void {
  const s = state;
  if (s.phase !== 'ended' || s.rematch === 'requested' || s.rematch === 'unavailable') return;
  conn.send({ type: 'rematch' });
  dispatch({ type: 'rematch-requested' });
}

/** Resign mid-battle: the server awards the opponent the win; we record the loss locally. */
export function resign(): void {
  const s = state;
  if (s.phase !== 'matched' && s.phase !== 'playing') return;
  conn.send({ type: 'leave' });
  finish({ result: 'loss', reason: 'resigned', you: s.me, opponent: s.opp }, true);
}

/** Claim the win early (vs a struck-out bot while ahead). */
export function claim(): void {
  if (state.phase !== 'playing') return;
  conn.send({ type: 'claim' });
}

export function backToLobby(): void {
  const s = state;
  if (s.phase === 'matched' || s.phase === 'playing') return resign();
  searchGen++;
  if (s.phase === 'searching') conn.send({ type: 'cancel' });
  if (s.phase === 'ended') conn.send({ type: 'leave' });
  dispatch({ type: 'to-lobby' });
}

export const clearError = (): void => dispatch({ type: 'clear-error' });
export const goPlaying = (): void => dispatch({ type: 'go' });
export const expireRematch = (): void => dispatch({ type: 'rematch-expired' });

/**
 * The Battle page went away: abandoning a live battle counts as a loss, searches and pending challenges are
 * withdrawn, and the next visit starts at the lobby. The socket stays open (it is app-wide).
 */
export function leaveBattlePage(): void {
  const s = state;
  if (s.phase === 'matched' || s.phase === 'playing') {
    conn.send({ type: 'leave' });
    finish({ result: 'loss', reason: 'resigned', you: s.me, opponent: s.opp }, true);
  } else if (s.phase === 'searching') {
    conn.send({ type: 'cancel' });
  } else if (s.phase === 'ended') {
    conn.send({ type: 'leave' });
  }
  searchGen++;
  cancelChallenge();
  outgoingDispatch({ type: 'dismiss' });
  dispatch({ type: 'to-lobby' });
}

// ---- friend challenges ---------------------------------------------------------------------------------------

let outgoing: OutgoingState = idleOutgoing;
let incoming: readonly Invite[] = [];
export interface ChallengeSnapshot {
  outgoing: OutgoingState;
  incoming: readonly Invite[];
}
let challengeSnap: ChallengeSnapshot = { outgoing, incoming };
const challengeListeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function publishChallenges(): void {
  if (challengeSnap.outgoing === outgoing && challengeSnap.incoming === incoming) return;
  challengeSnap = { outgoing, incoming };
  challengeListeners.forEach((fn) => fn());
  // Tick only while something is waiting on a clock.
  const needTick = outgoing.kind === 'sending' || outgoing.kind === 'waiting' || incoming.length > 0;
  if (needTick && !ticker) ticker = setInterval(tickChallenges, 1000);
  else if (!needTick && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function outgoingDispatch(a: OutgoingAction): void {
  outgoing = outgoingReducer(outgoing, a);
  publishChallenges();
}

function incomingDispatch(a: IncomingAction): void {
  incoming = incomingReducer(incoming, a);
  publishChallenges();
}

function tickChallenges(): void {
  outgoingDispatch({ type: 'tick', serverNow: conn.serverNow(), localNow: Date.now() });
  incomingDispatch({ type: 'tick', serverNow: conn.serverNow() });
}

export const getChallengeSnapshot = (): ChallengeSnapshot => challengeSnap;

function subscribeChallenges(fn: () => void): () => void {
  challengeListeners.add(fn);
  return () => {
    challengeListeners.delete(fn);
  };
}

export function useChallenges(): ChallengeSnapshot {
  return useSyncExternalStore(subscribeChallenges, getChallengeSnapshot, getChallengeSnapshot);
}

function failOutgoing(status: ChallengeResult): void {
  outgoingDispatch({ type: 'fail', status });
}

/**
 * Send a challenge to a friend's code. Problems that can be known locally are reported without a round trip.
 * Only options that differ from the defaults go on the wire, so plain challenges look as they always did.
 */
export function sendChallenge(raw: string, settings: BattleSettings = DEFAULT_BATTLE_SETTINGS, series: Series = 1): void {
  if (state.phase !== 'lobby' && state.phase !== 'ended') return;
  if (outgoing.kind === 'sending' || outgoing.kind === 'waiting') return;
  const code = normalizeCode(raw);
  if (!isValidCode(code)) return failOutgoing('invalid');
  const snap = conn.getSnapshot();
  if (snap.status === 'outdated') return failOutgoing('server-outdated');
  if (snap.moved) return failOutgoing('server-moved');
  if (snap.status === 'offline') {
    conn.reconnectNow();
    return failOutgoing('server-offline');
  }
  if (snap.status === 'waking') return failOutgoing('server-waking');
  if (snap.status !== 'online') return failOutgoing('server-connecting');
  if (code === snap.code) return failOutgoing('self');
  // An older server silently ignores custom settings and series: do not send what it would drop.
  const extras = challengeExtras(settings, series);
  if ((extras.settings || extras.series) && !serverSupports(snap.serverCaps, 'settings')) return failOutgoing('server-outdated');
  outgoingDispatch({ type: 'send', code, at: Date.now() });
  if (!conn.send({ type: 'challenge', code, ...extras })) failOutgoing('server-offline');
}

export function cancelChallenge(): void {
  if (outgoing.kind !== 'sending' && outgoing.kind !== 'waiting') return;
  conn.send({ type: 'challenge-cancel' });
  outgoingDispatch({ type: 'cancel' });
}

export const dismissChallengeResult = (): void => outgoingDispatch({ type: 'dismiss' });

/** Answer an invitation. Accepting also drops a search in progress (the server removes me from the queue). */
export function respondToInvite(id: string, accept: boolean): void {
  incomingDispatch({ type: 'respond', id });
  if (accept) {
    searchGen++;
    dispatch({ type: 'cancel' });
  }
  conn.send({ type: 'challenge-respond', id, accept });
}

// ---- wiring --------------------------------------------------------------------------------------------------

let wired = false;

function onEvent(ev: conn.ConnEvent): void {
  if (ev.type === 'open') return;
  if (ev.type === 'closed') {
    if ((state.phase === 'matched' || state.phase === 'playing') && serverReconnects) holdBattle();
    else dispatch({ type: 'connection-lost' });
    outgoingDispatch({ type: 'connection-lost' });
    incomingDispatch({ type: 'clear' });
    return;
  }
  const msg = ev.msg;
  switch (msg.type) {
    case 'welcome':
      serverReconnects = Array.isArray(msg.caps) && msg.caps.includes('reconnect');
      // A server that cannot hold seats has already given the opponent the win.
      if (!serverReconnects && state.reconnectingSince) dispatch({ type: 'connection-lost' });
      return;
    case 'end':
      finish({ result: msg.result, reason: msg.reason, you: msg.you, opponent: msg.opponent });
      return;
    case 'matched':
      if (msg.friendly && msg.opponentCode) {
        const { opponentCode: code, opponent } = msg;
        updateRecent((l) => upsertOpponent(l, { code, name: opponent.name, rating: opponent.rating, at: Date.now() }));
      }
      outgoingDispatch({ type: 'matched' });
      incomingDispatch({ type: 'clear' });
      if (msg.resume && state.reconnectingSince && state.match?.roomId === msg.roomId) {
        // Seat taken back: send again whatever the server missed while the connection was down.
        const missing = missingProgress(state.history, msg.resume.me);
        dispatch({ type: 'server', msg, me: conn.getPlayer() });
        replayQueue = missing;
        flushReplay(msg.roomId);
        return;
      }
      dispatch({ type: 'server', msg, me: conn.getPlayer() });
      return;
    case 'challenge-status': {
      const inFlight = outgoing.kind === 'sending' || outgoing.kind === 'waiting';
      if (!inFlight && msg.status === 'unavailable') {
        // My Accept came too late (the sender left or is busy).
        toast({ title: 'That challenge is no longer available', body: msg.name ? `${msg.name} can't play right now.` : undefined, icon: 'swords', tone: 'sky' });
      }
      outgoingDispatch({ type: 'status', status: msg.status, name: msg.name, expiresAt: msg.expiresAt });
      return;
    }
    case 'challenge-received':
      incomingDispatch({
        type: 'received',
        invite: { id: msg.id, from: msg.from, expiresAt: msg.expiresAt, ...(msg.settings ? { settings: msg.settings } : {}), ...(msg.series ? { series: msg.series } : {}) },
      });
      return;
    case 'challenge-withdrawn':
      incomingDispatch({ type: 'withdrawn', id: msg.id });
      return;
    case 'error':
      if (msg.message === FRIEND_MOVED_MESSAGE) {
        // Another tab holds the friend code now; this tab's pending challenges and invitations are gone.
        incomingDispatch({ type: 'clear' });
        if (outgoing.kind === 'sending' || outgoing.kind === 'waiting') failOutgoing('server-moved');
        return;
      }
      dispatch({ type: 'server', msg, me: conn.getPlayer() });
      return;
    default:
      dispatch({ type: 'server', msg, me: conn.getPlayer() });
  }
}

/** Attach the store to the shared socket (idempotent). Safe to call before the socket is open. */
export function initBattleStore(): void {
  if (wired) return;
  wired = true;
  conn.setResumeProvider(() => (state.reconnectingSince ? state.match?.roomId : undefined));
  conn.subscribe(onEvent);
}

/** Open the shared battle socket and wire the store. Called from the app shell shortly after load. */
export function startBattleNetwork(): void {
  initBattleStore();
  conn.start();
}
