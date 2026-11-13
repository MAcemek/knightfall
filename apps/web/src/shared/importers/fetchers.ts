import { parseGameInput, parsePgnGames } from '@knightfall/core';
import type { StoredGame } from '../db.ts';
import { gameFromChesscom, gameFromLichess, gameFromPgn, ImportError, USERNAME } from './mappers.ts';

/**
 * Network side of game import. No tokens, no accounts: only public endpoints.
 *  - Lichess: called straight from the browser (CORS is open). One request at a time; a 429 becomes a
 *    "busy, try in a minute" error and nothing is retried automatically.
 *  - chess.com by username: the official api.chess.com archives, called serially from the browser.
 *  - chess.com by link: our own server route /api/chesscom/game/:type/:id (chess.com has no public
 *    "game by id" endpoint); when it fails the error carries the manual fallback to offer.
 */

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  body?: ReadableStream<Uint8Array> | null;
}
export type FetchFn = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<FetchResponse>;

const defaultFetch: FetchFn = (url, init) => fetch(url, init);

export const DEFAULT_MAX_GAMES = 30;

/** Read newline-delimited JSON from a byte stream, calling `onObject` per line as it arrives. Bad lines are skipped. */
export async function readNdjson(stream: ReadableStream<Uint8Array>, onObject: (value: unknown) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (line: string) => {
    const text = line.trim();
    if (!text) return;
    try {
      onObject(JSON.parse(text));
    } catch {
      /* skip a malformed line */
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      flush(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  }
  flush(buffer + decoder.decode());
}

/** Lichess asks API users to make one request at a time. */
let lichessChain: Promise<unknown> = Promise.resolve();
function lichessSerial<T>(job: () => Promise<T>): Promise<T> {
  const next = lichessChain.then(job, job);
  lichessChain = next.catch(() => {});
  return next;
}

async function request(fetchFn: FetchFn, url: string, site: string, accept: string, signal?: AbortSignal): Promise<FetchResponse> {
  let res: FetchResponse;
  try {
    res = await fetchFn(url, { headers: { Accept: accept }, signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new ImportError('network', `${site} could not be reached. Check your connection.`);
  }
  if (res.status === 429) throw new ImportError('rate_limited', `${site} is busy. Try again in a minute.`);
  return res;
}

export async function fetchLichessGame(id: string, fetchFn: FetchFn = defaultFetch, now = Date.now()): Promise<StoredGame> {
  if (!/^[A-Za-z0-9]{8}$/.test(id)) throw new ImportError('invalid', 'That is not a Lichess game id.');
  return lichessSerial(async () => {
    const url = `https://lichess.org/game/export/${id}?pgnInJson=true&clocks=true&evals=false&opening=true&accuracy=true`;
    const res = await request(fetchFn, url, 'Lichess', 'application/json');
    if (res.status === 404) throw new ImportError('not_found', 'Lichess has no game with that id.', 'pgn');
    if (!res.ok) throw new ImportError('network', `Lichess answered with an error (${res.status}).`);
    const game = gameFromLichess(await res.json(), now);
    if (!game) throw new ImportError('invalid', 'That game cannot be analysed (only standard chess is supported).');
    return game;
  });
}

export interface UserGamesOptions {
  max?: number;
  signal?: AbortSignal;
  /** Called for every game as soon as it has been read (Lichess streams them). */
  onGame?: (game: StoredGame) => void;
  fetchFn?: FetchFn;
  now?: number;
}

/** The newest games of a Lichess user, newest first (standard chess only). */
export async function fetchLichessUserGames(username: string, opts: UserGamesOptions = {}): Promise<StoredGame[]> {
  const user = username.trim();
  if (!USERNAME.test(user)) throw new ImportError('invalid', 'Enter a Lichess username (letters, digits, - and _).');
  const { max = DEFAULT_MAX_GAMES, signal, onGame, fetchFn = defaultFetch, now = Date.now() } = opts;
  return lichessSerial(async () => {
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&pgnInJson=true&clocks=true&opening=true&accuracy=true&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`;
    const res = await request(fetchFn, url, 'Lichess', 'application/x-ndjson', signal);
    if (res.status === 404) throw new ImportError('not_found', `Lichess has no player called "${user}".`);
    if (!res.ok || !res.body) throw new ImportError('network', `Lichess answered with an error (${res.status}).`);
    const games: StoredGame[] = [];
    await readNdjson(res.body, (obj) => {
      const g = gameFromLichess(obj, now, user);
      if (!g) return;
      games.push(g);
      onGame?.(g);
    });
    return games;
  });
}

/** The newest games of a chess.com player, newest first: the latest one or two monthly archives, fetched one after the other. */
export async function fetchChesscomUserGames(username: string, opts: UserGamesOptions = {}): Promise<StoredGame[]> {
  const user = username.trim().toLowerCase();
  if (!USERNAME.test(user)) throw new ImportError('invalid', 'Enter a chess.com username (letters, digits, - and _).');
  const { max = DEFAULT_MAX_GAMES, signal, onGame, fetchFn = defaultFetch, now = Date.now() } = opts;
  const root = `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games`;
  const list = await request(fetchFn, `${root}/archives`, 'chess.com', 'application/json', signal);
  if (list.status === 404) throw new ImportError('not_found', `chess.com has no player called "${username.trim()}".`);
  if (!list.ok) throw new ImportError('network', `chess.com answered with an error (${list.status}).`);
  const body = (await list.json()) as { archives?: unknown };
  // Never follow a URL from the response: only its year/month are used to rebuild our own.
  const months = (Array.isArray(body.archives) ? body.archives : [])
    .map((u) => /^https:\/\/api\.chess\.com\/pub\/player\/[^/]+\/games\/(\d{4})\/(\d{2})$/.exec(typeof u === 'string' ? u : ''))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${m[1]}/${m[2]}`)
    .sort()
    .reverse()
    .slice(0, 2);
  const games: StoredGame[] = [];
  for (const month of months) {
    if (games.length >= max) break;
    const res = await request(fetchFn, `${root}/${month}`, 'chess.com', 'application/json', signal);
    if (!res.ok) continue;
    const archive = (await res.json()) as { games?: unknown };
    const rows = (Array.isArray(archive.games) ? archive.games : [])
      .map((g) => gameFromChesscom(g, now, user))
      .filter((g): g is StoredGame => !!g)
      .sort((a, b) => b.playedAt - a.playedAt);
    for (const g of rows) {
      if (games.length >= max) break;
      games.push(g);
      onGame?.(g);
    }
  }
  return games;
}

/** One chess.com game by link, through the Knightfall server. */
export async function fetchChesscomGame(type: 'live' | 'daily', id: string, fetchFn: FetchFn = defaultFetch, now = Date.now()): Promise<StoredGame> {
  if (!/^\d{1,20}$/.test(id)) throw new ImportError('invalid', 'That is not a chess.com game id.', 'pgn');
  const unreachable = new ImportError('server', 'The Knightfall server could not be reached, so the link cannot be looked up.', 'username');
  let res: FetchResponse;
  try {
    res = await fetchFn(`/api/chesscom/game/${type}/${id}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw unreachable;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Not JSON: the dev proxy or a static host answered instead of the server.
    throw unreachable;
  }
  if (!res.ok) {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { error?: unknown; code?: unknown; fallback?: unknown };
    const fallback = b.fallback === 'username' || b.fallback === 'pgn' ? b.fallback : 'username';
    const code = b.code === 'not_found' || b.code === 'not_finished' ? 'not_found' : b.code === 'rate_limited' ? 'rate_limited' : 'server';
    throw new ImportError(code, typeof b.error === 'string' ? b.error : 'The game could not be looked up.', fallback);
  }
  const game = gameFromChesscom(body, now);
  if (!game) throw new ImportError('invalid', 'That game cannot be analysed (only standard chess is supported).', 'pgn');
  return game;
}

/**
 * Resolve whatever the user pasted (link, id or PGN) into games. Throws ImportError with a ready-to-show message.
 * `warnings` lists PGN games that were skipped.
 */
export async function resolveGameInput(text: string, fetchFn: FetchFn = defaultFetch, now = Date.now()): Promise<{ games: StoredGame[]; warnings: string[] }> {
  const input = parseGameInput(text);
  switch (input.kind) {
    case 'error':
      throw new ImportError('invalid', input.message);
    case 'lichess':
      return { games: [await fetchLichessGame(input.id, fetchFn, now)], warnings: [] };
    case 'chesscom':
      return { games: [await fetchChesscomGame(input.type, input.id, fetchFn, now)], warnings: [] };
    case 'pgn': {
      const { games, errors } = parsePgnGames(input.pgn);
      if (!games.length) throw new ImportError('invalid', errors[0] ?? 'That PGN could not be read.');
      return { games: games.map((g) => gameFromPgn(g, now)), warnings: errors };
    }
  }
}
