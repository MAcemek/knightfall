import { hashString, parsePgnGame, pgnDateToMs, type ParsedGame } from '@knightfall/core';
import type { GamePlayer, StoredGame } from '../db.ts';

/** Pure conversions from what Lichess / chess.com / a PGN give us to a StoredGame. No network, no IndexedDB. */

export type ImportErrorCode = 'invalid' | 'not_found' | 'rate_limited' | 'network' | 'server';

/** Every importer failure. `message` is ready to show; `fallback` names the manual path to offer. */
export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly fallback?: 'username' | 'pgn',
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Usernames on both sites: letters, digits, "_" and "-". Checked before a name is put into a URL. */
export const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const elo = (x: string | undefined): number | undefined => {
  const n = Number(x);
  return x && Number.isFinite(n) && n > 0 ? n : undefined;
};

function player(name: string, rating?: number, title?: string): GamePlayer {
  return { name, ...(rating !== undefined ? { rating } : {}), ...(title ? { title } : {}) };
}

function base(parsed: ParsedGame, now: number): Pick<StoredGame, 'pgn' | 'result' | 'plies' | 'importedAt' | 'playedAt' | 'timeControl'> {
  const h = parsed.headers;
  return {
    pgn: parsed.pgn,
    result: parsed.result,
    plies: parsed.sans.length,
    importedAt: now,
    playedAt: pgnDateToMs(h.UTCDate ?? h.Date, h.UTCTime ?? h.StartTime) ?? now,
    ...(h.TimeControl ? { timeControl: h.TimeControl } : {}),
  };
}

/** A pasted PGN game. The key is a hash of the moves and the main headers, so re-pasting finds the same row. */
export function gameFromPgn(parsed: ParsedGame, now: number): StoredGame {
  const h = parsed.headers;
  const key = `pgn-${hashString([parsed.startFen, parsed.ucis.join(' '), h.White ?? '', h.Black ?? '', h.Date ?? ''].join('|')).toString(36)}`;
  const opening = h.Opening || h.ECO ? { ...(h.ECO ? { eco: h.ECO } : {}), ...(h.Opening ? { name: h.Opening } : {}) } : undefined;
  return {
    key,
    source: 'pgn',
    ...base(parsed, now),
    white: player(h.White ?? 'White', elo(h.WhiteElo), h.WhiteTitle),
    black: player(h.Black ?? 'Black', elo(h.BlackElo), h.BlackTitle),
    ...(opening ? { opening } : {}),
  };
}

function lichessPlayer(p: unknown): GamePlayer {
  if (!isRecord(p)) return player('Anonymous');
  const user = isRecord(p.user) ? p.user : null;
  const name = (user && str(user.name)) ?? (num(p.aiLevel) !== undefined ? `Stockfish level ${p.aiLevel}` : 'Anonymous');
  return player(name, num(p.rating), user ? str(user.title) : undefined);
}

/**
 * One game object from the Lichess API (game export JSON or one ndjson line, requested with pgnInJson=true).
 * Null for variants, games without a PGN, or anything unreadable.
 */
export function gameFromLichess(json: unknown, now: number, importedFor?: string): StoredGame | null {
  if (!isRecord(json)) return null;
  const id = str(json.id);
  const pgn = str(json.pgn);
  if (!id || !/^[A-Za-z0-9]{8}$/.test(id) || !pgn) return null;
  if (json.variant !== undefined && json.variant !== 'standard' && json.variant !== 'fromPosition') return null;
  const parsed = parsePgnGame(pgn);
  if (!parsed.ok) return null;
  const players = isRecord(json.players) ? json.players : {};
  const acc = (p: unknown) => (isRecord(p) && isRecord(p.analysis) ? num(p.analysis.accuracy) : undefined);
  const wa = acc(players.white);
  const ba = acc(players.black);
  const op = isRecord(json.opening) ? json.opening : null;
  return {
    key: `li-${id}`,
    source: 'lichess',
    url: `https://lichess.org/${id}`,
    ...base(parsed.game, now),
    ...(num(json.createdAt) !== undefined ? { playedAt: num(json.createdAt)! } : {}),
    white: lichessPlayer(players.white),
    black: lichessPlayer(players.black),
    ...(str(json.speed) ? { speed: str(json.speed) } : {}),
    ...(op && (str(op.eco) || str(op.name)) ? { opening: { ...(str(op.eco) ? { eco: str(op.eco) } : {}), ...(str(op.name) ? { name: str(op.name) } : {}) } } : {}),
    ...(wa !== undefined && ba !== undefined ? { siteAccuracy: { white: wa, black: ba } } : {}),
    ...(importedFor ? { importedFor: importedFor.toLowerCase() } : {}),
  };
}

/** "https://www.chess.com/openings/Kings-Indian-Defense-Fianchetto" -> "Kings Indian Defense Fianchetto". */
function chesscomOpeningName(ecoUrl: string | undefined): string | undefined {
  const slug = ecoUrl?.split('/').pop();
  return slug ? decodeURIComponent(slug).replace(/-/g, ' ').replace(/\s+/g, ' ').trim() || undefined : undefined;
}

/**
 * One chess.com game: an entry of a monthly archive (snake_case fields) or the body of our own
 * /api/chesscom/game route (camelCase fields). Null for variants or anything unreadable.
 */
export function gameFromChesscom(json: unknown, now: number, importedFor?: string): StoredGame | null {
  if (!isRecord(json)) return null;
  const url = str(json.url);
  const pgn = str(json.pgn);
  const m = /\/game\/(live|daily)\/(\d{1,20})$/.exec(url ?? '');
  if (!url || !pgn || !m) return null;
  if (json.rules !== undefined && json.rules !== 'chess') return null;
  const parsed = parsePgnGame(pgn);
  if (!parsed.ok) return null;
  const h = parsed.game.headers;
  const side = (p: unknown, fallback: string | undefined, rating: string | undefined) =>
    isRecord(p) ? player(str(p.username) ?? fallback ?? '?', num(p.rating) ?? elo(rating)) : player(fallback ?? '?', elo(rating));
  const acc = isRecord(json.accuracies) ? { white: num(json.accuracies.white), black: num(json.accuracies.black) } : null;
  const end = num(json.end_time) ?? num(json.endTime);
  const speed = str(json.time_class) ?? str(json.timeClass);
  const name = chesscomOpeningName(h.ECOUrl);
  return {
    key: `cc-${m[1]}-${m[2]}`,
    source: 'chesscom',
    url,
    ...base(parsed.game, now),
    ...(end !== undefined ? { playedAt: end * 1000 } : {}),
    white: side(json.white, h.White, h.WhiteElo),
    black: side(json.black, h.Black, h.BlackElo),
    ...(speed ? { speed } : {}),
    ...(h.ECO || name ? { opening: { ...(h.ECO ? { eco: h.ECO } : {}), ...(name ? { name } : {}) } } : {}),
    ...(acc && acc.white !== undefined && acc.black !== undefined ? { siteAccuracy: { white: acc.white, black: acc.black } } : {}),
    ...(importedFor ? { importedFor: importedFor.toLowerCase() } : {}),
  };
}

/** Which colour `username` played in `game` (case-insensitive), or null. */
export function sideOf(game: Pick<StoredGame, 'white' | 'black'>, username: string | undefined): 'w' | 'b' | null {
  const u = username?.toLowerCase();
  if (!u) return null;
  if (game.white.name.toLowerCase() === u) return 'w';
  if (game.black.name.toLowerCase() === u) return 'b';
  return null;
}
