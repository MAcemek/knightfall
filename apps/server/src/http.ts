import type { IncomingMessage, ServerResponse } from 'node:http';
import { apiError, type LookupResult } from './chesscom.ts';

/** The server's small JSON API. Side-effect free: index.ts wires it to a real http.Server. */

export interface HttpDeps {
  chesscom: (type: string, id: string) => Promise<LookupResult>;
}

export interface ApiReply {
  status: number;
  body: unknown;
}

const CHESSCOM_ROUTE = /^\/api\/chesscom\/game\/(live|daily)\/(\d{1,20})$/;

/** Parse "/api/chesscom/game/live/123" (query string ignored). Null when the path is anything else. */
export function matchChesscomRoute(url: string): { type: 'live' | 'daily'; id: string } | null {
  const path = url.split('?')[0].replace(/\/+$/, '');
  const m = CHESSCOM_ROUTE.exec(path);
  return m ? { type: m[1] as 'live' | 'daily', id: m[2] } : null;
}

/** Route one request. Pure apart from `deps`. */
export async function handleApi(method: string, url: string, deps: HttpDeps): Promise<ApiReply> {
  const path = url.split('?')[0].replace(/\/+$/, '');
  if (!path.startsWith('/api/') && path !== '/api') return { status: 404, body: { error: 'Not found', code: 'not_found', fallback: 'pgn' } };
  if (method !== 'GET') return { status: 405, body: { error: 'Only GET is supported.', code: 'bad_request', fallback: 'pgn' } };
  if (path === '/api/health') return { status: 200, body: { ok: true } };
  const route = matchChesscomRoute(url);
  if (route) return deps.chesscom(route.type, route.id);
  if (path.startsWith('/api/chesscom/game')) return apiError('bad_request', 'Expected /api/chesscom/game/live|daily/<digits>.', 'pgn');
  return { status: 404, body: { error: 'Not found', code: 'not_found', fallback: 'pgn' } };
}

/** Node request listener for http.createServer. Never throws. */
export function createHttpHandler(deps: HttpDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handleApi(req.method ?? 'GET', req.url ?? '/', deps)
      .catch((): ApiReply => ({ status: 500, body: { error: 'Server error', code: 'upstream', fallback: 'pgn' } }))
      .then((reply) => {
        const text = JSON.stringify(reply.body);
        res.writeHead(reply.status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(text),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          ...(reply.status === 405 ? { Allow: 'GET' } : {}),
        });
        res.end(text);
      });
  };
}
