import { WebSocketServer } from 'ws';

/** PLACEHOLDER — replaced by the Puzzle Battle server. */
const PORT = Number(process.env.KF_SERVER_PORT ?? 8787);
const wss = new WebSocketServer({ port: PORT, path: '/ws' });
wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'error', message: 'Battle server not implemented yet' })));
console.log(`[knightfall] battle server listening on ws://localhost:${PORT}/ws`);
