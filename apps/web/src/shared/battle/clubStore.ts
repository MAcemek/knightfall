import { useSyncExternalStore } from 'react';
import { DEFAULT_BATTLE_SETTINGS, normalizeCode, isValidCode, type BattleSettings } from '@knightfall/core';
import { db, defaults, getKV, KEYS } from '../db.ts';
import { getPlayerName } from '../profile.ts';
import { CLUB_NO_ANSWER_TEXT, CLUB_REPLY_TIMEOUT_MS, clubBlockedText, clubReducer, clubRecord, initialClubState, raceKey, type ClubAction, type ClubUiState } from '../../features/battle/clubLogic.ts';
import * as conn from './connection.ts';
import { WELCOME_TIMEOUT_MS } from './connectionLogic.ts';

/**
 * Module store for the club room, fed by the shared socket (like store.ts for battles). The reducer and all
 * wording live in features/battle/clubLogic.ts; this file adds the socket sends and saving the race record.
 */

let state: ClubUiState = initialClubState;
const listeners = new Set<() => void>();
let savedRace: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function dispatch(a: ClubAction): void {
  const next = clubReducer(state, a);
  if (next === state) return;
  state = next;
  if (pendingTimer && !state.pending) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  listeners.forEach((fn) => fn());
}

export const getClubState = (): ClubUiState => state;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useClub(): ClubUiState {
  return useSyncExternalStore(subscribe, getClubState, getClubState);
}

/** Save the finished race once (spectators and unfinished races give no record). */
function saveRace(): void {
  const room = state.room;
  if (!room) return;
  const record = clubRecord(room, Date.now());
  if (!record || savedRace === raceKey(room)) return;
  savedRace = raceKey(room);
  void db.battles.add(record).catch((e) => console.error('Failed to save club race', e));
}

function onEvent(ev: conn.ConnEvent): void {
  if (ev.type === 'open') return;
  if (ev.type === 'closed') return dispatch({ type: 'connection-lost' });
  if (ev.msg.type !== 'club-state' && ev.msg.type !== 'club-error') return;
  dispatch({ type: 'server', msg: ev.msg });
  saveRace();
}

let wired = false;

/** Attach the store to the shared socket (idempotent). */
export function initClubStore(): void {
  if (wired) return;
  wired = true;
  conn.subscribe(onEvent);
}

/** The socket opens before `welcome` arrives (which carries the server's capabilities): wait for it, bounded. */
function whenWelcomed(): Promise<void> {
  return new Promise((resolve) => {
    const settled = () => conn.getSnapshot().status !== 'connecting';
    if (settled()) return resolve();
    const limit = setTimeout(done, WELCOME_TIMEOUT_MS + 1000);
    const off = conn.subscribeSnapshot(() => {
      if (settled()) done();
    });
    function done() {
      clearTimeout(limit);
      off();
      resolve();
    }
  });
}

async function request(kind: 'create' | 'join', msg: Parameters<typeof conn.send>[0]): Promise<void> {
  if (state.room || state.pending) return;
  dispatch({ type: 'pending', kind });
  const [name, rating] = await Promise.all([getPlayerName(), getKV<number>(KEYS.battleRating, defaults.battleRating)]);
  conn.setPlayer({ name, rating });
  try {
    await conn.whenOpen();
  } catch {
    return dispatch({ type: 'fail', error: conn.OFFLINE_MESSAGE });
  }
  await whenWelcomed();
  if (state.pending !== kind) return; // cancelled meanwhile
  const snap = conn.getSnapshot();
  const blocked = clubBlockedText(snap.status, snap.serverCaps);
  if (blocked) return dispatch({ type: 'fail', error: blocked });
  if (!conn.send(msg)) return dispatch({ type: 'fail', error: conn.OFFLINE_MESSAGE });
  pendingTimer = setTimeout(() => dispatch({ type: 'fail', error: CLUB_NO_ANSWER_TEXT }), CLUB_REPLY_TIMEOUT_MS);
}

export function createClub(settings: BattleSettings = DEFAULT_BATTLE_SETTINGS): Promise<void> {
  return request('create', { type: 'club-create', settings });
}

export function joinClub(raw: string): Promise<void> {
  const code = normalizeCode(raw);
  if (!isValidCode(code)) {
    dispatch({ type: 'fail', error: "That code isn't valid. Check it and try again." });
    return Promise.resolve();
  }
  return request('join', { type: 'club-join', code });
}

export function leaveClub(): void {
  if (state.room || state.pending) conn.send({ type: 'club-leave' });
  dispatch({ type: 'left' });
}

export const startClubRace = (): boolean => conn.send({ type: 'club-start' });
export const newClubRace = (): boolean => conn.send({ type: 'club-new-race' });
export const dismissClubError = (): void => dispatch({ type: 'clear-error' });

/** After every puzzle: the same `progress` message a 1v1 battle uses. */
export function reportClubProgress(index: number, solved: number, strikes: number): void {
  if (state.room?.phase !== 'playing') return;
  conn.send({ type: 'progress', index, solved, strikes });
}
