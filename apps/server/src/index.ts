import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { decode, encode, type ClientMessage } from '@knightfall/core';
import { createChesscomLookup } from './chesscom.ts';
import { isClientMessage } from './clientTypes.ts';
import { guard } from './guard.ts';
import { createHttpHandler } from './http.ts';
import { BattleHub, Session } from './hub.ts';
import { MessageRateLimiter } from './rateLimit.ts';

/**
 * Knightfall server, one port:
 *   - WebSocket /ws      Puzzle Battle (matchmaking + authoritative rooms)
 *   - HTTP GET /api/...  small JSON API (chess.com game lookup for Game Review)
 */

const PORT = Number(process.env.KF_SERVER_PORT ?? (process.env.NODE_ENV === 'production' ? process.env.PORT : undefined) ?? 8787);
const HEARTBEAT_MS = 30_000;

// One bad room or message must not take every battle down: log and keep serving.
process.on('uncaughtException', (err) => console.error('[knightfall] uncaught exception', err));
process.on('unhandledRejection', (reason) => console.error('[knightfall] unhandled rejection', reason));

const hub = new BattleHub((line) => console.log(`[battle] ${line}`));
hub.startTicking();

const server = createServer(createHttpHandler({ chesscom: createChesscomLookup({ fetch: (url, init) => fetch(url, init) }) }));
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 });
const alive = new WeakMap<WebSocket, boolean>();

wss.on('connection', (ws) => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));

  const session = new Session((msg) => {
    if (ws.readyState === ws.OPEN) ws.send(encode(msg));
  });

  const limiter = new MessageRateLimiter();
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const { verdict, firstDrop } = limiter.hit(Date.now());
    if (verdict === 'close') {
      if (ws.readyState === ws.OPEN) {
        console.warn('[battle] closing a socket that sent too many messages');
        ws.close(1008, 'Too many messages');
      }
      return;
    }
    if (verdict === 'drop') {
      if (firstDrop) console.warn('[battle] ignoring messages from a socket that sends too fast');
      return;
    }
    const msg = decode<ClientMessage>(data.toString());
    if (!isClientMessage(msg)) return;
    try {
      hub.handle(session, msg);
    } catch (err) {
      console.error('[battle] handler error', err);
    }
  });

  ws.on('close', () => hub.disconnect(session));
  ws.on('error', () => ws.terminate());
});

const heartbeat = setInterval(guard('heartbeat', () => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}), HEARTBEAT_MS);

server.on('listening', () => console.log(`[knightfall] server ready: ws://localhost:${PORT}/ws and http://localhost:${PORT}/api`));
server.on('error', (err) => {
  console.error(`[knightfall] server failed: ${err.message}`);
  process.exitCode = 1;
});
// With an external http server, ws reports its own errors here; without a listener they would crash the process.
wss.on('error', (err) => console.error(`[knightfall] websocket error: ${err.message}`));
wss.on('close', () => clearInterval(heartbeat));
server.listen(PORT);

const shutdown = () => {
  hub.stop();
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.terminate();
  wss.close();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
