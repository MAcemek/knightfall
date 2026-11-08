import { Chess, validateFen, type Square } from 'chess.js';
import { uciToMove, validateLine } from '@knightfall/core';

/**
 * Pure logic for Custom Puzzles: editor position model, position validation,
 * puzzle-draft validation, share-link encoding and import parsing.
 * No React / no IndexedDB here so it can be unit-tested with vitest.
 */

/* ------------------------------------------------------------------ */
/* Position model                                                      */
/* ------------------------------------------------------------------ */

export type Side = 'w' | 'b';
/** FEN piece letter: uppercase = white, lowercase = black. */
export type PieceChar = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
export type CastleFlag = 'K' | 'Q' | 'k' | 'q';

export interface EditorPosition {
  /** square ("e4") -> piece letter */
  pieces: Record<string, PieceChar>;
  turn: Side;
  /** Castling rights the author wants; only the structurally possible ones end up in the FEN. */
  castling: Record<CastleFlag, boolean>;
  /** En-passant target square or '-'. Kept only when it came from a pasted FEN. */
  ep: string;
  halfmove: number;
  fullmove: number;
}

export const FILES = 'abcdefgh';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';
const PIECE_RE = /^[KQRBNPkqrbnp]$/;
const ALL_CASTLES: CastleFlag[] = ['K', 'Q', 'k', 'q'];

export function opposite(s: Side): Side {
  return s === 'w' ? 'b' : 'w';
}

export function sideName(s: Side): 'White' | 'Black' {
  return s === 'w' ? 'White' : 'Black';
}

/** Parse a (possibly partial) FEN into an editor position. Only the placement field is required. */
export function parseFen(fen: string): { ok: true; position: EditorPosition } | { ok: false; error: string } {
  const parts = fen.trim().split(/\s+/);
  if (!parts[0]) return { ok: false, error: 'FEN is empty.' };
  const rows = parts[0].split('/');
  if (rows.length !== 8) return { ok: false, error: 'The board part needs 8 ranks separated by "/".' };
  const pieces: Record<string, PieceChar> = {};
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/[1-8]/.test(ch)) {
        f += Number(ch);
      } else if (PIECE_RE.test(ch)) {
        if (f > 7) return { ok: false, error: `Rank ${8 - r} has more than 8 squares.` };
        pieces[`${FILES[f]}${8 - r}`] = ch as PieceChar;
        f++;
      } else {
        return { ok: false, error: `Unknown piece letter "${ch}".` };
      }
    }
    if (f !== 8) return { ok: false, error: `Rank ${8 - r} has ${f} squares instead of 8.` };
  }
  const turnRaw = parts[1] ?? 'w';
  if (turnRaw !== 'w' && turnRaw !== 'b') return { ok: false, error: 'Side to move must be "w" or "b".' };
  const castleRaw = parts[2] ?? '-';
  if (!/^(-|K?Q?k?q?)$/.test(castleRaw) || castleRaw === '') return { ok: false, error: 'Castling field must be "-" or a subset of "KQkq".' };
  const epRaw = parts[3] ?? '-';
  if (!/^(-|[a-h][36])$/.test(epRaw)) return { ok: false, error: 'En-passant field must be "-" or a square on rank 3/6.' };
  const half = parts[4] === undefined ? 0 : Number(parts[4]);
  const full = parts[5] === undefined ? 1 : Number(parts[5]);
  if (!Number.isInteger(half) || half < 0) return { ok: false, error: 'Half-move clock must be a non-negative integer.' };
  if (!Number.isInteger(full) || full < 1) return { ok: false, error: 'Move number must be a positive integer.' };
  const castling = { K: false, Q: false, k: false, q: false };
  for (const c of castleRaw) if (c !== '-') castling[c as CastleFlag] = true;
  return { ok: true, position: { pieces, turn: turnRaw, castling, ep: epRaw, halfmove: half, fullmove: full } };
}

/** Which castling rights are structurally possible (king and rook on their home squares). */
export function possibleCastling(pieces: Record<string, PieceChar>): Record<CastleFlag, boolean> {
  return {
    K: pieces.e1 === 'K' && pieces.h1 === 'R',
    Q: pieces.e1 === 'K' && pieces.a1 === 'R',
    k: pieces.e8 === 'k' && pieces.h8 === 'r',
    q: pieces.e8 === 'k' && pieces.a8 === 'r',
  };
}

export function placementOf(pieces: Record<string, PieceChar>): string {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pieces[`${FILES[f]}${r}`];
      if (p) {
        if (empty) row += empty;
        empty = 0;
        row += p;
      } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

/** Build a FEN, keeping only castling rights that are structurally possible. */
export function toFen(pos: EditorPosition): string {
  const possible = possibleCastling(pos.pieces);
  const castle = ALL_CASTLES.filter((c) => pos.castling[c] && possible[c]).join('') || '-';
  return `${placementOf(pos.pieces)} ${pos.turn} ${castle} ${pos.ep} ${pos.halfmove} ${pos.fullmove}`;
}

/** Parse + re-serialize a FEN (drops impossible castling rights). Returns null when unparsable. */
export function normalizeFen(fen: string): string | null {
  const r = parseFen(fen);
  return r.ok ? toFen(r.position) : null;
}

/**
 * Check that a position is a sensible puzzle start. Returns a human-readable error or null.
 *  - exactly one king per side
 *  - no pawns on the 1st/8th rank, at most 8 pawns per side
 *  - the side NOT to move is not in check
 *  - the side to move has at least one legal move
 */
export function validatePosition(fen: string): string | null {
  const parsed = parseFen(fen);
  if (!parsed.ok) return parsed.error;
  const { pieces, turn } = parsed.position;
  const list = Object.entries(pieces);
  const count = (p: PieceChar) => list.filter(([, x]) => x === p).length;
  const wk = count('K');
  const bk = count('k');
  if (wk === 0) return 'White needs a king.';
  if (bk === 0) return 'Black needs a king.';
  if (wk > 1) return 'White has more than one king.';
  if (bk > 1) return 'Black has more than one king.';
  const edgePawn = list.find(([sq, p]) => (p === 'P' || p === 'p') && (sq[1] === '1' || sq[1] === '8'));
  if (edgePawn) return `Pawns can't stand on the first or last rank (${edgePawn[0]}).`;
  if (count('P') > 8) return 'White has more than 8 pawns.';
  if (count('p') > 8) return 'Black has more than 8 pawns.';

  const full = toFen(parsed.position);
  let loose: Chess;
  try {
    loose = new Chess(full, { skipValidation: true });
  } catch (e) {
    return (e as Error).message;
  }
  const notToMove = opposite(turn);
  const kingSq = list.find(([, p]) => p === (notToMove === 'w' ? 'K' : 'k'))![0] as Square;
  if (loose.isAttacked(kingSq, turn)) {
    return `${sideName(notToMove)} is in check but it's ${sideName(turn)}'s move. Switch the side to move or fix the position.`;
  }
  const v = validateFen(full);
  if (!v.ok) return (v.error ?? 'Invalid position.').replace(/^Invalid FEN: /, '');
  const chess = new Chess(full);
  if (chess.moves().length === 0) {
    return chess.isCheckmate() ? `${sideName(turn)} is already checkmated.` : `${sideName(turn)} has no legal moves (stalemate).`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Puzzle drafts                                                       */
/* ------------------------------------------------------------------ */

export interface PuzzleDraft {
  fen: string;
  moves: string[];
  opponentFirst: boolean;
  title: string;
  themes: string[];
  rating: number;
}

export const RATING_MIN = 400;
export const RATING_MAX = 2800;
export const DEFAULT_RATING = 1500;
export const TITLE_MAX = 80;
export const THEME_MAX = 12;

export const PRESET_THEMES = [
  'mate',
  'mateIn1',
  'mateIn2',
  'fork',
  'pin',
  'skewer',
  'sacrifice',
  'endgame',
  'discoveredAttack',
  'deflection',
  'promotion',
] as const;

const THEME_LABELS: Record<string, string> = {
  mate: 'Checkmate',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  discoveredAttack: 'Discovered attack',
};

/** "discoveredAttack" -> "Discovered attack", custom free text left as-is. */
export function themeLabel(t: string): string {
  if (THEME_LABELS[t]) return THEME_LABELS[t];
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(t)) {
    const words = t.replace(/([A-Z0-9])/g, ' $1').toLowerCase().trim();
    return words[0].toUpperCase() + words.slice(1);
  }
  return t.length ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Normalize a free-text theme: trimmed, collapsed whitespace, max 24 chars. */
export function cleanTheme(t: string): string {
  return t.trim().replace(/\s+/g, ' ').slice(0, 24);
}

export function clampRating(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_RATING;
  return Math.round(Math.min(RATING_MAX, Math.max(RATING_MIN, r)));
}

/** Colour that has to find the moves. */
export function solverSide(fen: string, opponentFirst: boolean): Side {
  const stm: Side = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  return opponentFirst ? opposite(stm) : stm;
}

/** Whether ply `i` of a line is played by the solver (mirrors core's isPlayerPly). */
export function isSolverPly(i: number, opponentFirst: boolean): boolean {
  return i % 2 === (opponentFirst ? 1 : 0);
}

/** Error for a recorded line that doesn't make a playable puzzle, or null. */
export function lineError(moves: string[], opponentFirst: boolean): string | null {
  const solverMoves = moves.filter((_, i) => isSolverPly(i, opponentFirst)).length;
  if (solverMoves === 0) return opponentFirst ? 'Play the setup move, then the first solution move.' : 'Play at least one solution move.';
  if (!isSolverPly(moves.length - 1, opponentFirst)) return "The line must end with a solver move. Undo the last opponent move or add the solver's reply.";
  return null;
}

/** SAN for each move of a line (falls back to UCI when a move is illegal). */
export function sanLine(fen: string, moves: string[]): string[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return moves.slice();
  }
  const out: string[] = [];
  for (const uci of moves) {
    try {
      out.push(chess.move(uciToMove(uci)).san);
    } catch {
      out.push(uci);
    }
  }
  return out;
}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * Validate an untrusted puzzle-ish object (share link payload, import file).
 * Returns a cleaned draft or an error message.
 */
export function validateDraft(input: {
  fen: unknown;
  moves: unknown;
  opponentFirst: unknown;
  title?: unknown;
  themes?: unknown;
  rating?: unknown;
}): { ok: true; draft: PuzzleDraft } | { ok: false; error: string } {
  if (typeof input.fen !== 'string' || input.fen.length > 120) return { ok: false, error: 'Missing or invalid position.' };
  const fen = normalizeFen(input.fen);
  if (!fen) return { ok: false, error: 'The position (FEN) is malformed.' };
  const posErr = validatePosition(fen);
  if (posErr) return { ok: false, error: posErr };

  let moves: string[];
  if (Array.isArray(input.moves)) moves = input.moves.map(String);
  else if (typeof input.moves === 'string') moves = input.moves.split(/\s+/).filter(Boolean);
  else return { ok: false, error: 'Missing solution moves.' };
  if (moves.length === 0 || moves.length > 60) return { ok: false, error: 'The solution must have between 1 and 60 moves.' };
  const bad = moves.find((m) => !UCI_RE.test(m));
  if (bad) return { ok: false, error: `"${bad.slice(0, 12)}" is not a valid move.` };

  const opponentFirst = input.opponentFirst === true || input.opponentFirst === 1 || input.opponentFirst === '1';
  const legalErr = validateLine(fen, moves);
  if (legalErr) return { ok: false, error: legalErr };
  const lErr = lineError(moves, opponentFirst);
  if (lErr) return { ok: false, error: lErr };

  const title = typeof input.title === 'string' ? input.title.trim().slice(0, TITLE_MAX) : '';
  const themes = Array.isArray(input.themes)
    ? [...new Set(input.themes.filter((t): t is string => typeof t === 'string').map(cleanTheme).filter(Boolean))].slice(0, THEME_MAX)
    : [];
  const rating = clampRating(typeof input.rating === 'number' ? input.rating : Number(input.rating ?? DEFAULT_RATING));
  return { ok: true, draft: { fen, moves, opponentFirst, title, themes, rating } };
}

/* ------------------------------------------------------------------ */
/* Share links                                                         */
/* ------------------------------------------------------------------ */

/** Compact wire format stored in the URL hash. */
interface SharePayload {
  f: string;
  m: string;
  o: 0 | 1;
  t?: string;
  th?: string[];
  r?: number;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function encodeShare(d: PuzzleDraft): string {
  const payload: SharePayload = { f: d.fen, m: d.moves.join(' '), o: d.opponentFirst ? 1 : 0 };
  if (d.title) payload.t = d.title;
  if (d.themes.length) payload.th = d.themes;
  payload.r = d.rating;
  return toBase64Url(JSON.stringify(payload));
}

export function decodeShare(data: string): { ok: true; draft: PuzzleDraft } | { ok: false; error: string } {
  const raw = data.trim().replace(/^#/, '');
  if (!raw) return { ok: false, error: 'This link has no puzzle in it.' };
  if (raw.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(raw)) return { ok: false, error: 'This share link is damaged or incomplete.' };
  let obj: unknown;
  try {
    obj = JSON.parse(fromBase64Url(raw));
  } catch {
    return { ok: false, error: 'This share link is damaged or incomplete.' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'This share link is damaged or incomplete.' };
  const p = obj as Record<string, unknown>;
  return validateDraft({ fen: p.f, moves: p.m, opponentFirst: p.o, title: p.t, themes: p.th, rating: p.r });
}

export function shareUrl(origin: string, d: PuzzleDraft): string {
  return `${origin}/custom/s#${encodeShare(d)}`;
}

/* ------------------------------------------------------------------ */
/* Import / export                                                     */
/* ------------------------------------------------------------------ */

export const EXPORT_FORMAT = 'knightfall-custom-puzzles';

export interface ImportedPuzzle extends PuzzleDraft {
  id?: string;
  createdAt?: number;
  plays?: number;
  solves?: number;
}

/** Parse an export file. Accepts the export envelope or a bare array of puzzles. */
export function parseImport(text: string): { puzzles: ImportedPuzzle[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { puzzles: [], errors: ['The file is not valid JSON.'] };
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { puzzles?: unknown }).puzzles)
      ? (data as { puzzles: unknown[] }).puzzles
      : null;
  if (!list) return { puzzles: [], errors: ['No puzzles found in this file.'] };
  if (list.length > 5000) return { puzzles: [], errors: ['Too many puzzles in one file (max 5000).'] };

  const puzzles: ImportedPuzzle[] = [];
  const errors: string[] = [];
  list.forEach((item, i) => {
    if (!item || typeof item !== 'object') {
      errors.push(`#${i + 1}: not a puzzle object.`);
      return;
    }
    const o = item as Record<string, unknown>;
    const r = validateDraft({ fen: o.fen, moves: o.moves, opponentFirst: o.opponentFirst, title: o.title, themes: o.themes, rating: o.rating });
    if (!r.ok) {
      errors.push(`#${i + 1}${typeof o.title === 'string' && o.title ? ` "${o.title.slice(0, 30)}"` : ''}: ${r.error}`);
      return;
    }
    const nonNeg = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
    puzzles.push({
      ...r.draft,
      id: typeof o.id === 'string' && /^c_[a-z0-9]{4,24}$/.test(o.id) ? o.id : undefined,
      createdAt: nonNeg(o.createdAt),
      plays: nonNeg(o.plays),
      solves: nonNeg(o.solves),
    });
  });
  return { puzzles, errors };
}

/** Identity of a puzzle's content (position + line), used to detect duplicates. */
export function contentKey(p: { fen: string; moves: string[]; opponentFirst: boolean }): string {
  return `${p.fen.split(' ').slice(0, 4).join(' ')}|${p.moves.join(' ')}|${p.opponentFirst ? 1 : 0}`;
}

export function newCustomId(): string {
  let s = '';
  while (s.length < 10) s += Math.random().toString(36).slice(2);
  return `c_${s.slice(0, 10)}`;
}

/** Title to show for a puzzle; untitled ones get a descriptive fallback. */
export function displayTitle(p: { title?: string; fen: string; opponentFirst: boolean; themes: string[] }): string {
  if (p.title && p.title.trim()) return p.title.trim();
  const side = sideName(solverSide(p.fen, p.opponentFirst));
  const mate = p.themes.find((t) => /^mateIn\d$/.test(t));
  return mate ? `${side} to play · ${themeLabel(mate).toLowerCase()}` : `${side} to play`;
}
