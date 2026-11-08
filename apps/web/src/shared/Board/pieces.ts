import type { Square } from 'chess.js';

export type Color = 'w' | 'b';
export type PieceCode = `${Color}${'K' | 'Q' | 'R' | 'B' | 'N' | 'P'}`;

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export function pieceUrl(code: PieceCode): string {
  return `/pieces/${code}.svg`;
}

/** Board coordinates for rendering: column 0..7 left→right, row 0..7 top→bottom. */
export function squareToXY(sq: string, orientation: 'white' | 'black'): { col: number; row: number } {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  return orientation === 'white' ? { col: f, row: 7 - r } : { col: 7 - f, row: r };
}

export function xyToSquare(col: number, row: number, orientation: 'white' | 'black'): Square | null {
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const f = orientation === 'white' ? col : 7 - col;
  const r = orientation === 'white' ? 7 - row : row;
  return `${FILES[f]}${r + 1}` as Square;
}

export function isLightSquare(sq: string): boolean {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  return (f + r) % 2 === 1;
}

/** Parse the piece-placement part of a FEN into square → piece code. */
export function parseFenPieces(fen: string): Map<string, PieceCode> {
  const out = new Map<string, PieceCode>();
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r] ?? '') {
      if (/\d/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
      out.set(`${FILES[f]}${8 - r}`, `${color}${ch.toUpperCase()}` as PieceCode);
      f++;
    }
  }
  return out;
}

export interface TrackedPiece {
  id: number;
  sq: string;
  code: PieceCode;
  isNew?: boolean;
}

let nextId = 1;

/**
 * Match pieces in the new position to pieces in the previous one so each keeps a stable React key.
 * Stable keys + CSS transitions on transform = pieces visibly slide when they move (incl. castling).
 */
export function trackPieces(prev: TrackedPiece[], next: Map<string, PieceCode>): TrackedPiece[] {
  const result: TrackedPiece[] = [];
  const unmatchedNew: [string, PieceCode][] = [];
  const prevBySq = new Map(prev.map((p) => [p.sq, p]));
  const used = new Set<number>();
  for (const [sq, code] of next) {
    const p = prevBySq.get(sq);
    if (p && p.code === code) {
      result.push({ id: p.id, sq, code });
      used.add(p.id);
    } else unmatchedNew.push([sq, code]);
  }
  const leftovers = prev.filter((p) => !used.has(p.id));
  for (const [sq, code] of unmatchedNew) {
    let best: TrackedPiece | null = null;
    let bestD = Infinity;
    for (const p of leftovers) {
      if (p.code !== code || used.has(p.id)) continue;
      const d = Math.abs(p.sq.charCodeAt(0) - sq.charCodeAt(0)) + Math.abs(Number(p.sq[1]) - Number(sq[1]));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) {
      used.add(best.id);
      result.push({ id: best.id, sq, code });
    } else result.push({ id: nextId++, sq, code, isNew: prev.length > 0 });
  }
  return result;
}
