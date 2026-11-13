import { useCallback, useEffect, useReducer, useRef } from 'react';
import { decode, eloUpdate, encode, type BattleScore, type ClientMessage, type PlayerInfo, type ServerMessage } from '@knightfall/core';
import { db, defaults, getKV, KEYS, setKV, type BattleRecord } from '../../shared/db.ts';
import { getPlayerName } from '../../shared/profile.ts';
import {
  battleReducer, initialBattleState, REMATCH_WINDOW_MS, resultScore,
  type BattleState, type EndInfo, type MatchInfo,
} from './battleState.ts';

/**
 * Where the battle server lives. VITE_BATTLE_URL (e.g. wss://battle.example.com/ws) points a static
 * deployment such as Vercel at a separately hosted apps/server; otherwise the same origin's /ws is used
 * (the dev proxy, or apps/server serving behind the same host).
 */
const BATTLE_URL: string | undefined = import.meta.env.VITE_BATTLE_URL || undefined;

export const OFFLINE_MESSAGE =
  import.meta.env.DEV ? 'Battle server offline — run npm run dev' : 'The battle server is offline right now. Try again in a minute.';
const CONNECT_TIMEOUT_MS = 5000;
const PING_EVERY_MS = 15_000;

function socketUrl() {
  return BATTLE_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export interface BattleApi {
  state: BattleState;
  /** Current server time estimate (epoch ms). */
  serverNow: () => number;
  findOpponent: () => void;
  cancel: () => void;
  reportResult: (puzzle: { id: string; rating: number }, solved: boolean) => void;
  rematch: () => void;
  resign: () => void;
  /** Claim the win early (vs a struck-out bot while ahead). */
  claim: () => void;
  backToLobby: () => void;
  clearError: () => void;
}

/**
 * Owns the battle WebSocket, the server clock offset and the battle state machine.
 * Persists every finished battle (Elo + BattleRecord) exactly once.
 */
export function useBattle(): BattleApi {
  const [state, dispatch] = useReducer(battleReducer, initialBattleState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const wsRef = useRef<WebSocket | null>(null);
  const intentionalClose = useRef(new WeakSet<WebSocket>());
  const offsetRef = useRef(0);
  const bestRttRef = useRef(Infinity);
  const pingSentAt = useRef(0);
  const meRef = useRef<PlayerInfo>({ name: 'Player', rating: defaults.battleRating });
  /** Live copy of the current match (updated synchronously from socket messages). */
  const matchRef = useRef<MatchInfo | null>(null);
  const savedRoom = useRef<string | null>(null);
  const searchGen = useRef(0);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
  }, []);

  const ping = useCallback(() => {
    pingSentAt.current = Date.now();
    send({ type: 'ping' });
  }, [send]);

  /** Compute Elo, persist the record and move to the end screen. Idempotent per room. */
  const finish = useCallback(
    (raw: { result: EndInfo['result']; reason: EndInfo['reason']; you: BattleScore; opponent: BattleScore }, rematchClosed = false) => {
      const match = matchRef.current;
      if (!match || savedRoom.current === match.roomId) return;
      savedRoom.current = match.roomId;
      const ratingBefore = match.me.rating;
      const ratingAfter = eloUpdate(ratingBefore, match.opponent.rating, resultScore(raw.result));
      meRef.current = { ...meRef.current, rating: ratingAfter };
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
      };
      void Promise.all([db.battles.add(record), setKV(KEYS.battleRating, ratingAfter)]).catch((e) => console.error('Failed to save battle', e));
    },
    [],
  );

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'pong': {
          const now = Date.now();
          const rtt = now - pingSentAt.current;
          if (pingSentAt.current && rtt >= 0 && rtt <= bestRttRef.current) {
            bestRttRef.current = rtt;
            offsetRef.current = msg.serverNow + rtt / 2 - now;
          }
          return;
        }
        case 'matched':
          matchRef.current = { roomId: msg.roomId, seed: msg.seed, me: { ...meRef.current }, opponent: msg.opponent, startsAt: 0, endsAt: 0 };
          break;
        case 'start':
          if (bestRttRef.current === Infinity) offsetRef.current = msg.serverNow - Date.now();
          if (matchRef.current) matchRef.current = { ...matchRef.current, startsAt: msg.startsAt, endsAt: msg.endsAt };
          break;
        case 'end':
          finish({ result: msg.result, reason: msg.reason, you: msg.you, opponent: msg.opponent });
          return;
        default:
          break;
      }
      dispatch({ type: 'server', msg, me: meRef.current });
    },
    [finish],
  );
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const ensureSocket = useCallback(
    () =>
      new Promise<WebSocket>((resolve, reject) => {
        const cur = wsRef.current;
        if (cur && cur.readyState === WebSocket.OPEN) return resolve(cur);
        if (cur && cur.readyState === WebSocket.CONNECTING) {
          cur.addEventListener('open', () => resolve(cur), { once: true });
          cur.addEventListener('close', () => reject(new Error('offline')), { once: true });
          return;
        }
        let ws: WebSocket;
        try {
          ws = new WebSocket(socketUrl());
        } catch {
          reject(new Error('offline'));
          return;
        }
        wsRef.current = ws;
        let opened = false;
        let pinger: ReturnType<typeof setInterval> | null = null;
        const timeout = setTimeout(() => {
          if (!opened) {
            intentionalClose.current.add(ws);
            ws.close();
            reject(new Error('timeout'));
          }
        }, CONNECT_TIMEOUT_MS);
        ws.onopen = () => {
          opened = true;
          clearTimeout(timeout);
          bestRttRef.current = Infinity;
          ping();
          pinger = setInterval(ping, PING_EVERY_MS);
          resolve(ws);
        };
        ws.onmessage = (e) => {
          if (typeof e.data !== 'string') return;
          const msg = decode<ServerMessage>(e.data);
          if (msg) onMessageRef.current(msg);
        };
        ws.onerror = () => {
          if (!opened) {
            clearTimeout(timeout);
            reject(new Error('offline'));
          }
        };
        ws.onclose = () => {
          clearTimeout(timeout);
          if (pinger) clearInterval(pinger);
          if (wsRef.current === ws) wsRef.current = null;
          if (!opened) reject(new Error('offline'));
          else if (!intentionalClose.current.has(ws)) dispatch({ type: 'connection-lost' });
        };
      }),
    [ping],
  );

  const findOpponent = useCallback(() => {
    const phase = stateRef.current.phase;
    if (phase !== 'lobby' && phase !== 'ended') return;
    const gen = ++searchGen.current;
    // Leaving the post-game screen: the server detaches us from the old room when we queue again.
    dispatch({ type: 'connecting' });
    void (async () => {
      const [name, rating] = await Promise.all([getPlayerName(), getKV<number>(KEYS.battleRating, defaults.battleRating)]);
      meRef.current = { name, rating };
      try {
        await ensureSocket();
      } catch {
        if (gen === searchGen.current) dispatch({ type: 'to-lobby', error: OFFLINE_MESSAGE });
        return;
      }
      if (gen !== searchGen.current) return; // cancelled while connecting
      dispatch({ type: 'search-started', at: Date.now() });
      send({ type: 'queue', player: meRef.current });
    })();
  }, [ensureSocket, send]);

  const cancel = useCallback(() => {
    searchGen.current++;
    send({ type: 'cancel' });
    dispatch({ type: 'cancel' });
  }, [send]);

  const reportResult = useCallback(
    (puzzle: { id: string; rating: number }, solved: boolean) => {
      const s = stateRef.current;
      if (s.phase !== 'playing') return;
      const index = s.history.length;
      const solvedN = s.me.solved + (solved ? 1 : 0);
      const strikes = s.me.strikes + (solved ? 0 : 1);
      // Keep the ref in step so two results in one frame can't reuse a stale score.
      stateRef.current = battleReducer(s, { type: 'my-result', puzzle, solved });
      dispatch({ type: 'my-result', puzzle, solved });
      send({ type: 'progress', index, solved: solvedN, strikes });
    },
    [send],
  );

  const rematch = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'ended' || s.rematch === 'requested' || s.rematch === 'unavailable') return;
    send({ type: 'rematch' });
    dispatch({ type: 'rematch-requested' });
  }, [send]);

  /** Resign mid-battle: the server awards the opponent the win; we record the loss locally. */
  const resign = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'matched' && s.phase !== 'playing') return;
    send({ type: 'leave' });
    finish({ result: 'loss', reason: 'resigned', you: s.me, opponent: s.opp }, true);
  }, [send, finish]);

  const claim = useCallback(() => {
    if (stateRef.current.phase !== 'playing') return;
    send({ type: 'claim' });
  }, [send]);

  const backToLobby = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === 'matched' || s.phase === 'playing') return resign();
    searchGen.current++;
    if (s.phase === 'searching') send({ type: 'cancel' });
    if (s.phase === 'ended') send({ type: 'leave' });
    matchRef.current = null;
    dispatch({ type: 'to-lobby' });
  }, [send, resign]);

  const clearError = useCallback(() => dispatch({ type: 'clear-error' }), []);

  // Countdown finished -> playing.
  const startsAt = state.match?.startsAt ?? 0;
  useEffect(() => {
    if (state.phase !== 'matched' || !startsAt) return;
    const t = setTimeout(() => dispatch({ type: 'go' }), Math.max(0, startsAt - serverNow()));
    return () => clearTimeout(t);
  }, [state.phase, startsAt, serverNow]);

  // Rematch offers expire with the server's window.
  const endedAt = state.end?.endedAt ?? 0;
  useEffect(() => {
    if (state.phase !== 'ended' || !endedAt) return;
    const t = setTimeout(() => dispatch({ type: 'rematch-expired' }), Math.max(0, endedAt + REMATCH_WINDOW_MS - Date.now()));
    return () => clearTimeout(t);
  }, [state.phase, endedAt]);

  // Unmount: abandoning a live battle counts as a loss; always close the socket.
  useEffect(
    () => () => {
      const s = stateRef.current;
      if (s.phase === 'matched' || s.phase === 'playing') {
        send({ type: 'leave' });
        finish({ result: 'loss', reason: 'resigned', you: s.me, opponent: s.opp }, true);
      } else if (s.phase === 'searching') {
        send({ type: 'cancel' });
      }
      searchGen.current++;
      const ws = wsRef.current;
      if (ws) {
        intentionalClose.current.add(ws);
        ws.close();
        wsRef.current = null;
      }
    },
    [send, finish],
  );

  return { state, serverNow, findOpponent, cancel, reportResult, rematch, resign, claim, backToLobby, clearError };
}
