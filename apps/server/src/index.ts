import { WebSocketServer, type WebSocket } from 'ws';
import { decode, encode, type ClientMessage } from '@knightfall/core';
import { BattleHub, Session } from './hub.ts';

/** Knightfall Puzzle Battle server: matchmaking + authoritative battle rooms over WebSocket (/ws). */

const PORT = Number(process.env.KF_SERVER_PORT ?? (process.env.NODE_ENV === 'production' ? process.env.PORT : undefined) ?? 8787);
const HEARTBEAT_MS = 30_000;
const CLIENT_TYPES = new Set<ClientMessage['type']>(['queue', 'cancel', 'progress', 'rematch', 'leave', 'ping']);

const hub = new BattleHub((line) => console.log(`[battle] ${line}`));
hub.startTicking();

const wss = new WebSocketServer({ port: PORT, path: '/ws', maxPayload: 4 * 1024 });
const alive = new WeakMap<WebSocket, boolean>();

wss.on('connection', (ws) => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));

  const session = new Session((msg) => {
    if (ws.readyState === ws.OPEN) ws.send(encode(msg));
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const msg = decode<ClientMessage>(data.toString());
    if (!msg || !CLIENT_TYPES.has(msg.type)) return;
    try {
      hub.handle(session, msg);
    } catch (err) {
      console.error('[battle] handler error', err);
    }
  });

  ws.on('close', () => hub.disconnect(session));
  ws.on('error', () => ws.terminate());
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, HEARTBEAT_MS);

wss.on('listening', () => console.log(`[knightfall] battle server ready on ws://localhost:${PORT}/ws`));
wss.on('error', (err) => {
  console.error(`[knightfall] battle server failed: ${err.message}`);
  process.exitCode = 1;
});
wss.on('close', () => clearInterval(heartbeat));

const shutdown = () => {
  hub.stop();
  clearInterval(heartbeat);
  wss.close();
  for (const ws of wss.clients) ws.terminate();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
