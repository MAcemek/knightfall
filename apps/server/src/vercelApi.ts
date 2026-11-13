import type { IncomingMessage, ServerResponse } from 'node:http';
import { createChesscomLookup } from './chesscom.ts';
import { createHttpHandler } from './http.ts';

/**
 * The JSON API (chess.com game lookup, health) as a single Vercel function. scripts/build-vercel.mjs bundles
 * this file and rewrites /api/* to it with the original path in `?path=`. The cache and rate limit live per
 * function instance, which is fine for a cache.
 */

const handle = createHttpHandler({ chesscom: createChesscomLookup({ fetch: (url, init) => fetch(url, init) }) });

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const original = url.searchParams.get('path');
  // Only trust a rewritten path that stays inside /api/.
  if (original && original.startsWith('/api/')) req.url = original;
  else req.url = url.pathname;
  handle(req, res);
}
