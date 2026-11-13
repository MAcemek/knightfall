import { Chess } from 'chess.js';

/** PGN reading for game import: one or many games, headers, moves and %clk clock comments. */

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface ParsedGame {
  /** Tag pairs that were present in the PGN (chess.js placeholders such as "?" are dropped). */
  headers: Record<string, string>;
  startFen: string;
  sans: string[];
  /** UCI, same length as `sans`. */
  ucis: string[];
  /** Position before every move plus the final position: sans.length + 1 entries. */
  fens: string[];
  /** Clock after each move in ms, or null where the PGN has none. Same length as `sans`. */
  clocksMs: (number | null)[];
  result: GameResult;
  /** This game's own PGN text, trimmed. */
  pgn: string;
}

export type PgnParseResult = { ok: true; game: ParsedGame } | { ok: false; error: string };

/** Hard limits so a pasted database cannot freeze the tab. */
export const MAX_PGN_CHARS = 2_000_000;
export const MAX_PGN_GAMES = 50;

const TAG_LINE = /^\s*\[\s*[A-Za-z0-9_]+\s+"/;

/** Split PGN text into single games. A tag line after movetext starts the next game. */
export function splitPgn(text: string): string[] {
  const games: string[] = [];
  let cur: string[] = [];
  let sawMoves = false;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const isTag = TAG_LINE.test(line);
    if (isTag && sawMoves) {
      games.push(cur.join('\n').trim());
      cur = [];
      sawMoves = false;
    }
    if (!isTag && line.trim() && !line.trim().startsWith('%')) sawMoves = true;
    cur.push(line);
  }
  const last = cur.join('\n').trim();
  if (last) games.push(last);
  return games;
}

/** "0:03:00" / "1:02:03.4" / "5:00" -> milliseconds; null when it is not a clock. */
export function parseClock(text: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text.trim());
  if (!m) return null;
  const ms = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
  return Number.isFinite(ms) ? Math.round(ms) : null;
}

/** Every [%clk ...] in order of appearance. */
export function extractClocks(pgn: string): number[] {
  const out: number[] = [];
  for (const m of pgn.matchAll(/\[%clk\s+([0-9:.]+)\s*\]/g)) {
    const ms = parseClock(m[1]);
    if (ms !== null) out.push(ms);
  }
  return out;
}

function normaliseResult(r: string | undefined): GameResult {
  return r === '1-0' || r === '0-1' || r === '1/2-1/2' ? r : '*';
}

/** Parse ONE game. Only standard chess (any start position) is accepted. */
export function parsePgnGame(pgn: string): PgnParseResult {
  const text = pgn.trim();
  if (!text) return { ok: false, error: 'The PGN is empty.' };
  const chess = new Chess();
  try {
    chess.loadPgn(text);
  } catch {
    return { ok: false, error: 'That PGN could not be read. Check that it is complete and uses standard notation.' };
  }
  const allHeaders = chess.getHeaders();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(allHeaders)) {
    if (v && v !== '?' && v !== '????.??.??' && new RegExp(`\\[\\s*${k}\\s+"`).test(text)) headers[k] = v;
  }
  const variant = headers.Variant?.toLowerCase();
  if (variant && variant !== 'standard' && variant !== 'from position') {
    return { ok: false, error: `Only standard chess can be analysed (this game is ${headers.Variant}).` };
  }
  const history = chess.history({ verbose: true });
  if (!history.length) return { ok: false, error: 'That PGN has no moves.' };
  const clocks = extractClocks(text);
  return {
    ok: true,
    game: {
      headers,
      startFen: history[0].before,
      sans: history.map((m) => m.san),
      ucis: history.map((m) => m.lan),
      fens: [history[0].before, ...history.map((m) => m.after)],
      clocksMs: history.map((_, i) => (clocks.length === history.length ? clocks[i] : null)),
      result: normaliseResult(allHeaders.Result),
      pgn: text,
    },
  };
}

/**
 * Parse PGN text holding one or more games. Unreadable games are reported in `errors` ("Game 3: ...")
 * and skipped. At most MAX_PGN_GAMES games are read.
 */
export function parsePgnGames(text: string): { games: ParsedGame[]; errors: string[] } {
  if (text.length > MAX_PGN_CHARS) return { games: [], errors: ['That PGN is too large (max 2 MB).'] };
  const chunks = splitPgn(text);
  const games: ParsedGame[] = [];
  const errors: string[] = [];
  chunks.slice(0, MAX_PGN_GAMES).forEach((chunk, i) => {
    const r = parsePgnGame(chunk);
    if (r.ok) games.push(r.game);
    else errors.push(chunks.length > 1 ? `Game ${i + 1}: ${r.error}` : r.error);
  });
  if (chunks.length > MAX_PGN_GAMES) errors.push(`Only the first ${MAX_PGN_GAMES} games were read.`);
  if (!chunks.length) errors.push('The PGN is empty.');
  return { games, errors };
}

/** "2026.10.02" (+ optional "22:05:06") -> epoch ms (UTC), or null. */
export function pgnDateToMs(date: string | undefined, time?: string): number | null {
  const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date ?? '');
  if (!d) return null;
  const t = /^(\d{2}):(\d{2}):(\d{2})/.exec(time ?? '');
  const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), t ? Number(t[1]) : 0, t ? Number(t[2]) : 0, t ? Number(t[3]) : 0);
  return Number.isFinite(ms) ? ms : null;
}
