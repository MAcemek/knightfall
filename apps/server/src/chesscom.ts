import type { ApiErrorCode, ApiErrorResponse, ChesscomGameResponse, ChesscomGameType } from '@knightfall/core';
import { LruCache } from './lru.ts';

/**
 * chess.com game lookup by id.
 *
 * chess.com's public API has no "game by id" endpoint, so this takes two steps:
 *   1. GET https://www.chess.com/callback/{live|daily}/game/{id}   -> player names + end time
 *   2. GET https://api.chess.com/pub/player/{white}/games/{YYYY}/{MM} (official API) -> find the game by URL
 * Nothing but the validated type and numeric id ever reaches an upstream URL.
 */

export const USER_AGENT = 'Knightfall/0.1';

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface LookupResult {
  status: number;
  body: ChesscomGameResponse | ApiErrorResponse;
}

export interface ChesscomOptions {
  fetch: FetchLike;
  now?: () => number;
  /** Per upstream request. Default 8000. */
  timeoutMs?: number;
  /** Default 500. */
  cacheEntries?: number;
  /** How long a found game is cached. Default 10 minutes. */
  ttlMs?: number;
  /** How long a failure is cached (stops hammering upstream). Default 30 seconds. */
  errorTtlMs?: number;
  /** Uncached lookups allowed per minute, all clients together. Default 30. */
  maxPerMinute?: number;
}

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  not_finished: 409,
  rate_limited: 429,
  timeout: 504,
  upstream: 502,
};

export function apiError(code: ApiErrorCode, error: string, fallback: ApiErrorResponse['fallback']): LookupResult {
  return { status: HTTP_STATUS[code], body: { error, code, fallback } };
}

class UpstreamError extends Error {
  constructor(readonly code: ApiErrorCode, readonly status = 0) {
    super(code);
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x ? x : undefined);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const USERNAME = /^[A-Za-z0-9_-]{1,40}$/;

/** "2026.10.02" -> [2026, 10]; undefined when it is not a date. */
function monthOfPgnDate(date: unknown): [number, number] | undefined {
  const m = /^(\d{4})\.(\d{2})\.\d{2}$/.exec(typeof date === 'string' ? date : '');
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

function monthOfEpoch(seconds: number): [number, number] {
  const d = new Date(seconds * 1000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
}

/** Monthly archives to search, most likely first (archives are filed by the month the game ended). */
export function archiveMonths(endTime: number | undefined, pgnDate: unknown): [number, number][] {
  const out: [number, number][] = [];
  const push = (m: [number, number] | undefined) => {
    if (m && !out.some((x) => x[0] === m[0] && x[1] === m[1])) out.push(m);
  };
  if (endTime !== undefined) push(monthOfEpoch(endTime));
  const start = monthOfPgnDate(pgnDate);
  push(start);
  // A game that started on the last day of a month can be filed in the next one.
  if (start && endTime === undefined) push(start[1] === 12 ? [start[0] + 1, 1] : [start[0], start[1] + 1]);
  return out.slice(0, 2);
}

/** Pick the game with this type and id out of a monthly archive body. */
export function findInArchive(archive: unknown, type: ChesscomGameType, id: string): ChesscomGameResponse | null {
  const games = isRecord(archive) && Array.isArray(archive.games) ? archive.games : [];
  const suffix = `/${type}/${id}`;
  for (const g of games) {
    if (!isRecord(g)) continue;
    const url = str(g.url);
    const pgn = str(g.pgn);
    if (!url || !pgn || !url.endsWith(suffix)) continue;
    const player = (p: unknown) => (isRecord(p) ? { username: str(p.username) ?? '?', ...(num(p.rating) !== undefined ? { rating: num(p.rating) } : {}) } : { username: '?' });
    const acc = isRecord(g.accuracies) ? { white: num(g.accuracies.white), black: num(g.accuracies.black) } : null;
    return {
      pgn,
      url,
      white: player(g.white),
      black: player(g.black),
      ...(acc && acc.white !== undefined && acc.black !== undefined ? { accuracies: { white: acc.white, black: acc.black } } : {}),
      ...(str(g.time_class) ? { timeClass: str(g.time_class) } : {}),
      ...(num(g.end_time) !== undefined ? { endTime: num(g.end_time) } : {}),
    };
  }
  return null;
}

/**
 * Build the lookup function. It never throws: every failure becomes a structured error body with
 * the HTTP status to send and the manual fallback the UI should offer.
 */
export function createChesscomLookup(opts: ChesscomOptions): (type: string, id: string) => Promise<LookupResult> {
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const ttlMs = opts.ttlMs ?? 10 * 60_000;
  const errorTtlMs = opts.errorTtlMs ?? 30_000;
  const maxPerMinute = opts.maxPerMinute ?? 30;
  const cache = new LruCache<LookupResult>(opts.cacheEntries ?? 500, ttlMs, now);
  const inflight = new Map<string, Promise<LookupResult>>();
  /** One request at a time per upstream host. */
  const chains = new Map<string, Promise<unknown>>();
  let recent: number[] = [];

  function getJson(url: string): Promise<unknown> {
    const host = new URL(url).host;
    const run = async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await opts.fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ctl.signal });
        if (res.status === 404) throw new UpstreamError('not_found', 404);
        if (res.status === 429) throw new UpstreamError('rate_limited', 429);
        if (!res.ok) throw new UpstreamError('upstream', res.status);
        return await res.json();
      } catch (e) {
        if (e instanceof UpstreamError) throw e;
        throw new UpstreamError(ctl.signal.aborted ? 'timeout' : 'upstream');
      } finally {
        clearTimeout(timer);
      }
    };
    const next = (chains.get(host) ?? Promise.resolve()).then(run, run);
    chains.set(host, next.catch(() => {}));
    return next;
  }

  async function resolve(type: ChesscomGameType, id: string): Promise<LookupResult> {
    let callback: unknown;
    try {
      callback = await getJson(`https://www.chess.com/callback/${type}/game/${id}`);
    } catch (e) {
      const code = e instanceof UpstreamError ? e.code : 'upstream';
      if (code === 'not_found') return apiError('not_found', 'chess.com has no game with that id.', 'pgn');
      if (code === 'rate_limited') return apiError('rate_limited', 'chess.com is busy. Try again in a minute.', 'username');
      if (code === 'timeout') return apiError('timeout', 'chess.com took too long to answer.', 'username');
      return apiError('upstream', 'chess.com could not be reached.', 'username');
    }
    const game = isRecord(callback) && isRecord(callback.game) ? callback.game : null;
    const headers = game && isRecord(game.pgnHeaders) ? game.pgnHeaders : null;
    const white = headers ? str(headers.White) : undefined;
    const black = headers ? str(headers.Black) : undefined;
    if (!game || !headers || !white || !black || !USERNAME.test(white)) {
      return apiError('upstream', 'chess.com sent an answer Knightfall does not understand.', 'username');
    }
    if (game.isFinished === false) return apiError('not_finished', 'That game is still being played.', 'pgn');

    for (const [year, month] of archiveMonths(num(game.endTime), headers.Date)) {
      const mm = String(month).padStart(2, '0');
      try {
        const archive = await getJson(`https://api.chess.com/pub/player/${white.toLowerCase()}/games/${year}/${mm}`);
        const hit = findInArchive(archive, type, id);
        if (hit) return { status: 200, body: hit };
      } catch (e) {
        const code = e instanceof UpstreamError ? e.code : 'upstream';
        if (code === 'not_found') continue;
        if (code === 'rate_limited') return apiError('rate_limited', 'chess.com is busy. Try again in a minute.', 'username');
        if (code === 'timeout') return apiError('timeout', 'chess.com took too long to answer.', 'username');
        return apiError('upstream', 'chess.com could not be reached.', 'username');
      }
    }
    return apiError('not_found', `The game was not in ${white}'s public archive.`, 'username');
  }

  return async function lookup(type: string, id: string): Promise<LookupResult> {
    if ((type !== 'live' && type !== 'daily') || !/^\d{1,20}$/.test(id)) {
      return apiError('bad_request', 'Expected /api/chesscom/game/live|daily/<digits>.', 'pgn');
    }
    const key = `${type}/${id}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const running = inflight.get(key);
    if (running) return running;

    const t = now();
    recent = recent.filter((x) => t - x < 60_000);
    if (recent.length >= maxPerMinute) return apiError('rate_limited', 'Too many lookups right now. Try again in a minute.', 'pgn');
    recent.push(t);

    const job = resolve(type, id)
      .catch((): LookupResult => apiError('upstream', 'chess.com could not be reached.', 'username'))
      .then((result) => {
        const cacheable = result.status === 200 || result.status === 404 || result.status === 409;
        cache.set(key, result, result.status === 200 ? ttlMs : cacheable ? errorTtlMs : Math.min(errorTtlMs, 5000));
        inflight.delete(key);
        return result;
      });
    inflight.set(key, job);
    return job;
  };
}
