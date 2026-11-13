import type { ChesscomGameType } from './types.ts';

/** What the user pasted into the "analyse a game" box. */
export type GameInput =
  | { kind: 'lichess'; id: string; ply?: number; orientation?: 'white' | 'black' }
  | { kind: 'chesscom'; type: ChesscomGameType; id: string }
  | { kind: 'pgn'; pgn: string }
  | { kind: 'error'; message: string };

/** Lichess paths that are exactly 8 or 12 letters long and therefore look like a game id. */
const LICHESS_RESERVED = new Set(['training', 'analysis', 'practice', 'streamer', 'features', 'timeline', 'storm', 'tournament', 'broadcast']);
const LICHESS_ID = /^[A-Za-z0-9]{8}$/;
const LICHESS_ID_OR_FULL = /^[A-Za-z0-9]{8}(?:[A-Za-z0-9]{4})?$/;
const DIGITS = /^\d{1,20}$/;

const err = (message: string): GameInput => ({ kind: 'error', message });

function looksLikePgn(text: string): boolean {
  return /\[\s*(Event|Site|White|Black|Result|FEN)\s+"/.test(text) || /(^|\s)1\.\s*(\.\.\.)?\s*[a-hNBRQKO]/.test(text);
}

function parseLichessPath(segments: string[], hash: string): GameInput {
  let segs = segments;
  // /game/export/{id}, /embed/game/{id}, /embed/{id}
  if (segs[0] === 'game' && segs[1] === 'export') segs = segs.slice(2);
  else if (segs[0] === 'embed') segs = segs.slice(segs[1] === 'game' ? 2 : 1);
  const [first, second, ...rest] = segs;
  if (!first) return err('That Lichess link has no game id.');
  const idPart = first.replace(/\.pgn$/i, '');
  if (rest.length || !LICHESS_ID_OR_FULL.test(idPart) || LICHESS_RESERVED.has(idPart.toLowerCase())) {
    return err('That is not a Lichess game link. Open the game on Lichess and copy its address.');
  }
  if (second !== undefined && second !== 'white' && second !== 'black') {
    return err('That is not a Lichess game link. Open the game on Lichess and copy its address.');
  }
  const out: GameInput = { kind: 'lichess', id: idPart.slice(0, 8) };
  if (second === 'black') out.orientation = 'black';
  if (second === 'white') out.orientation = 'white';
  const ply = /^#?(\d{1,4})$/.exec(hash);
  if (ply) out.ply = Number(ply[1]);
  return out;
}

function parseChesscomPath(segments: string[]): GameInput {
  let segs = segments;
  // Optional locale prefix: /es/game/live/1, /pt-BR/game/live/1
  if (segs[0] && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(segs[0]) && segs.length > 1) segs = segs.slice(1);
  if (segs[0] === 'analysis') segs = segs.slice(1);
  const bad = err('That is not a chess.com game link. Use the game\'s Share button and copy the link.');
  let type: string | undefined;
  let id: string | undefined;
  if (segs[0] === 'game' && segs.length === 3) [, type, id] = segs; // /game/live/123
  else if (segs[0] === 'game' && segs.length === 2) [type, id] = ['live', segs[1]]; // /game/123
  else if ((segs[0] === 'live' || segs[0] === 'daily') && segs[1] === 'game' && segs.length === 3) [type, , id] = segs; // /live/game/123
  else return bad;
  if (type === 'computer') return err('Games against chess.com bots cannot be looked up. Paste the PGN instead.');
  if (type === 'pgn') return err('That link points to a pasted PGN on chess.com. Paste the PGN here instead.');
  if ((type !== 'live' && type !== 'daily') || !id || !DIGITS.test(id)) return bad;
  return { kind: 'chesscom', type, id };
}

/**
 * Work out what the user pasted: a Lichess game link or id, a chess.com game link, or PGN text.
 * Never throws and never touches the network.
 *
 * Lichess:   lichess.org/{id8}, /{id8}/white|black, /{id12} (id + player token), #ply suffix,
 *            /game/export/{id8}, /embed/game/{id8}, /embed/{id8}, or a bare 8/12-character id.
 * chess.com: /game/live/{n}, /game/daily/{n}, /game/{n}, /analysis/game/live|daily/{n}, /live/game/{n},
 *            /daily/game/{n}; www/locale prefixes and query strings are ignored.
 */
export function parseGameInput(text: string): GameInput {
  const raw = text.trim();
  if (!raw) return err('Paste a game link or a PGN.');
  if (looksLikePgn(raw)) return { kind: 'pgn', pgn: raw };
  if (/\s/.test(raw)) return err('That does not look like a game link or a PGN.');
  if (LICHESS_ID_OR_FULL.test(raw)) {
    if (LICHESS_RESERVED.has(raw.toLowerCase())) return err('That does not look like a game link or a PGN.');
    return { kind: 'lichess', id: raw.slice(0, 8) };
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return err('That does not look like a game link or a PGN.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return err('That does not look like a game link or a PGN.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);
  if (host === 'lichess.org') return parseLichessPath(segments, url.hash);
  if (host === 'chess.com') return parseChesscomPath(segments);
  return err('Only Lichess and chess.com links are supported. You can also paste a PGN.');
}

/** True for a string that is exactly a Lichess game id. */
export function isLichessGameId(id: string): boolean {
  return LICHESS_ID.test(id);
}
