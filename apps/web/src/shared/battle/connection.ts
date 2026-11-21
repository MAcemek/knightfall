import { useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { CLIENT_CAPS, decode, encode, FRIEND_MOVED_MESSAGE, type ClientMessage, type PlayerInfo, type ServerMessage } from '@knightfall/core';
import { defaults, getKV, KEYS, setKV } from '../db.ts';
import { getPlayerName } from '../profile.ts';
import {
  BACKOFF_MIN_MS, helloChanged, nextBackoff, statusAfterFailure, WELCOME_TIMEOUT_MS,
  type ConnStatus,
} from './connectionLogic.ts';

/**
 * The one app-wide battle WebSocket. Started from the app shell shortly after load and kept open, so friend
 * invitations reach the player on any page. Battles use this same socket (never a second one).
 *
 * Reconnects with backoff, sends `hello` (name, rating, stored code/token) on every open and whenever the
 * name or battle rating changes, and tracks the server clock offset.
 */

/**
 * Where the battle server lives. VITE_BATTLE_URL (e.g. wss://battle.example.com/ws) points a static
 * deployment such as Vercel at a separately hosted apps/server; otherwise the same origin's /ws is used
 * (the dev proxy, or apps/server serving behind the same host).
 */
const BATTLE_URL: string | undefined = import.meta.env.VITE_BATTLE_URL || undefined;

export const OFFLINE_MESSAGE =
  import.meta.env.DEV ? 'Battle server offline — run npm run dev' : 'The battle server is offline right now. Try again in a minute.';
const CONNECT_TIMEOUT_MS = 5000;
/** A free-tier host may be asleep: keep retrying the socket this long before reporting it offline. */
const WAKE_WINDOW_MS = BATTLE_URL ? 75_000 : 0;
const PING_EVERY_MS = 15_000;

export function socketUrl(): string {
  return BATTLE_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** Nudge a sleeping hosted battle server awake early (opaque request; the response is not needed). */
export function wakeBattleServer(): void {
  if (!BATTLE_URL) return;
  try {
    const health = new URL(BATTLE_URL.replace(/^ws/, 'http'));
    health.pathname = '/api/health';
    void fetch(health, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  } catch {
    /* malformed VITE_BATTLE_URL: the socket attempt reports offline */
  }
}

export type { ConnStatus };

export interface ConnSnapshot {
  status: ConnStatus;
  /** My friend code once the server has issued it (formatted by the UI). */
  code: string | null;
  /** The WebSocket is open (it may still be waiting for `welcome`). Random play only needs this. */
  socketOpen: boolean;
  /** Another tab of this browser took over the friend code: friend challenges only work there. */
  moved: boolean;
  /** Features the server announced in `welcome`; empty until then (and for an older server that sends none). */
  serverCaps: string[];
}

export type ConnEvent = { type: 'message'; msg: ServerMessage } | { type: 'open' } | { type: 'closed' };

let snap: ConnSnapshot = { status: 'connecting', code: null, socketOpen: false, moved: false, serverCaps: [] };
const snapListeners = new Set<() => void>();
const eventListeners = new Set<(e: ConnEvent) => void>();

function setSnap(patch: Partial<ConnSnapshot>): void {
  const next = { ...snap, ...patch };
  if (next.status === snap.status && next.code === snap.code && next.socketOpen === snap.socketOpen && next.moved === snap.moved && next.serverCaps === snap.serverCaps) return;
  snap = next;
  snapListeners.forEach((fn) => fn());
}

function emit(e: ConnEvent): void {
  eventListeners.forEach((fn) => fn(e));
}

let started = false;
let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = BACKOFF_MIN_MS;
let outageStart = 0;
let offset = 0;
let bestRtt = Infinity;
let pingSentAt = 0;
let me: PlayerInfo = { name: 'Player', rating: defaults.battleRating };
let lastHello: PlayerInfo | null = null;
let stored: { code: string | null; token: string | null } = { code: null, token: null };
let identityReady: Promise<void> = Promise.resolve();

/** Current server time estimate (epoch ms). */
export const serverNow = (): number => Date.now() + offset;

export const getSnapshot = (): ConnSnapshot => snap;

export function subscribeSnapshot(fn: () => void): () => void {
  snapListeners.add(fn);
  return () => {
    snapListeners.delete(fn);
  };
}

/** Messages and open/close events from the socket. */
export function subscribe(fn: (e: ConnEvent) => void): () => void {
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}

/** React hook over the connection status and my friend code. */
export function useConnection(): ConnSnapshot {
  return useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);
}

export function send(msg: ClientMessage): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(encode(msg));
  return true;
}

/** The player info the server last heard (or will hear in the next `hello`). */
export const getPlayer = (): PlayerInfo => me;

/** Update name/rating (after a finished battle, or fresh from storage); resends `hello` if it changed. */
export function setPlayer(info: PlayerInfo): void {
  me = info;
  sendHello();
}

function sendHello(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  void identityReady.then(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !helloChanged(lastHello, me)) return;
    lastHello = { ...me };
    send({ type: 'hello', player: lastHello, caps: [...CLIENT_CAPS], ...(stored.code && stored.token ? { code: stored.code, token: stored.token } : {}) });
  });
}

function ping(): void {
  pingSentAt = Date.now();
  send({ type: 'ping' });
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, backoff);
  backoff = nextBackoff(backoff);
}

function connect(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (ws) return;
  let sock: WebSocket;
  try {
    sock = new WebSocket(socketUrl());
  } catch {
    failed();
    return;
  }
  ws = sock;
  let opened = false;
  let pinger: ReturnType<typeof setInterval> | null = null;
  let welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  const attemptTimer = setTimeout(() => {
    if (!opened) sock.close();
  }, CONNECT_TIMEOUT_MS);

  sock.onopen = () => {
    opened = true;
    clearTimeout(attemptTimer);
    backoff = BACKOFF_MIN_MS;
    bestRtt = Infinity;
    lastHello = null;
    setSnap({ socketOpen: true, status: 'connecting', moved: false, serverCaps: [] });
    ping();
    pinger = setInterval(ping, PING_EVERY_MS);
    sendHello();
    // Only a server that knows friend play answers `hello` with `welcome`.
    welcomeTimer = setTimeout(() => {
      if (snap.status !== 'online') setSnap({ status: 'outdated' });
    }, WELCOME_TIMEOUT_MS);
    emit({ type: 'open' });
  };
  sock.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    const msg = decode<ServerMessage>(e.data);
    if (!msg) return;
    onMessage(msg);
  };
  sock.onerror = () => {
    /* onclose follows and handles both failed attempts and drops */
  };
  sock.onclose = () => {
    clearTimeout(attemptTimer);
    if (pinger) clearInterval(pinger);
    if (welcomeTimer) clearTimeout(welcomeTimer);
    if (ws !== sock) return;
    ws = null;
    if (opened) {
      setSnap({ socketOpen: false, status: 'connecting', serverCaps: [] });
      outageStart = Date.now();
      backoff = BACKOFF_MIN_MS;
      emit({ type: 'closed' });
      scheduleRetry();
    } else {
      failed();
    }
  };
}

function failed(): void {
  ws = null;
  setSnap({ socketOpen: false, serverCaps: [], status: statusAfterFailure(WAKE_WINDOW_MS, outageStart, Date.now()) });
  wakeBattleServer();
  scheduleRetry();
}

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'pong': {
      const now = Date.now();
      const rtt = now - pingSentAt;
      if (pingSentAt && rtt >= 0 && rtt <= bestRtt) {
        bestRtt = rtt;
        offset = msg.serverNow + rtt / 2 - now;
      }
      return;
    }
    case 'welcome':
      stored = { code: msg.code, token: msg.token };
      void Promise.all([setKV(KEYS.battleCode, msg.code), setKV(KEYS.battleToken, msg.token)]).catch(() => {});
      setSnap({ status: 'online', code: msg.code, moved: false, serverCaps: Array.isArray(msg.caps) ? msg.caps.filter((c): c is string => typeof c === 'string') : [] });
      return;
    case 'error':
      if (msg.message === FRIEND_MOVED_MESSAGE) setSnap({ moved: true });
      break;
    case 'start':
    case 'challenge-received':
    case 'challenge-status':
      // Before the first ping answer there is no round-trip estimate: take the server's word for "now".
      if (bestRtt === Infinity && typeof msg.serverNow === 'number') offset = msg.serverNow - Date.now();
      break;
    default:
      break;
  }
  emit({ type: 'message', msg });
}

/** Start now instead of waiting out the backoff (the user is trying to play). */
export function reconnectNow(): void {
  if (!started) return start();
  if (ws) return; // open or already connecting
  outageStart = Date.now();
  backoff = BACKOFF_MIN_MS;
  setSnap({ status: 'connecting' });
  connect();
}

async function readPlayer(): Promise<PlayerInfo> {
  const [name, rating] = await Promise.all([getPlayerName(), getKV<number>(KEYS.battleRating, defaults.battleRating)]);
  return { name, rating };
}

/** Open the shared socket (idempotent). */
export function start(): void {
  if (started) return;
  started = true;
  outageStart = Date.now();
  identityReady = (async () => {
    try {
      const [code, token, player] = await Promise.all([getKV<string | null>(KEYS.battleCode, null), getKV<string | null>(KEYS.battleToken, null), readPlayer()]);
      stored = { code, token };
      me = player;
    } catch {
      /* storage unavailable: connect anonymously with the defaults */
    }
  })();
  void identityReady.then(() => {
    if (!ws && started) connect();
  });
  wakeBattleServer();

  // Keep `hello` current: only act when the stored values really changed (a stale read must not undo a rating
  // I just set locally after a battle).
  let lastDb: PlayerInfo | null = null;
  liveQuery(async () => {
    const [name, rating] = await Promise.all([getKV<string>(KEYS.playerName, ''), getKV<number>(KEYS.battleRating, defaults.battleRating)]);
    return { name, rating };
  }).subscribe({
    next: (v) => {
      if (!v.name) return;
      if (lastDb && !helloChanged(lastDb, v)) return;
      lastDb = v;
      me = { name: v.name, rating: v.rating };
      sendHello();
    },
    error: () => {},
  });

  window.addEventListener('online', reconnectNow);
}

/**
 * Resolve once the socket is open. Rejects when the server is offline: straight away for a local server, or
 * after the wake window for a sleeping hosted one (the caller shows the "waking up" state meanwhile).
 */
export function whenOpen(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (snap.socketOpen) return resolve();
    if (!started) start();
    else if (!ws) reconnectNow();
    else if (snap.status === 'offline') {
      // An automatic retry is already in flight: give the player a fresh wake window.
      outageStart = Date.now();
      setSnap({ status: 'connecting' });
    }
    const limit = setTimeout(() => done(false), WAKE_WINDOW_MS + CONNECT_TIMEOUT_MS + 2000);
    const off = subscribeSnapshot(() => {
      if (snap.socketOpen) done(true);
      else if (snap.status === 'offline') done(false);
    });
    function done(ok: boolean) {
      clearTimeout(limit);
      off();
      if (ok) resolve();
      else reject(new Error('offline'));
    }
  });
}
