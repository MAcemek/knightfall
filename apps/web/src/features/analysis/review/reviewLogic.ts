import { Chess } from 'chess.js';
import { uciToMove, winPercent, type AnalysedMove, type GameResult, type PositionEval } from '@knightfall/core';

/** Pure helpers of the review page (no React, no IndexedDB). */

/** White's share of the eval bar, 0..1. Unknown positions sit in the middle. */
export function barFraction(e: PositionEval | undefined): number {
  return e ? winPercent(e.score) / 100 : 0.5;
}

export interface GraphPoint {
  /** Position index (0 = start position). */
  index: number;
  x: number;
  y: number;
}

export interface GraphGeometry {
  /** One entry per position; null where the evaluation is not known yet. */
  points: (GraphPoint | null)[];
  /** SVG path of the known stretches of the curve (gaps break the line). */
  line: string;
  /** Closed SVG path between the curve and the bottom edge (White's area). */
  area: string;
  /** y of the 50% line. */
  midY: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Geometry of the eval graph: x = position index spread over the width, y = White's win chance
 * (top = 100). `evals` may have holes while the analysis is running.
 */
export function graphGeometry(evals: readonly (PositionEval | undefined)[], width: number, height: number, pad = 4): GraphGeometry {
  const n = evals.length;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const xAt = (i: number) => pad + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (win: number) => pad + (1 - win / 100) * innerH;
  const points = evals.map((e, index) => (e ? { index, x: r1(xAt(index)), y: r1(yAt(winPercent(e.score))) } : null));
  let line = '';
  let area = '';
  let run: GraphPoint[] = [];
  const flush = () => {
    if (!run.length) return;
    const d = run.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
    line += (line ? ' ' : '') + d;
    const bottom = r1(height - pad);
    area += `${area ? ' ' : ''}${d} L${run[run.length - 1].x} ${bottom} L${run[0].x} ${bottom} Z`;
    run = [];
  };
  for (const p of points) {
    if (p) run.push(p);
    else flush();
  }
  flush();
  return { points, line, area, midY: r1(yAt(50)) };
}

/** Index of the known point closest to `x` (null when nothing is known yet). */
export function nearestPoint(points: readonly (GraphPoint | null)[], x: number): number | null {
  let best: number | null = null;
  let dist = Infinity;
  for (const p of points) {
    if (!p) continue;
    const d = Math.abs(p.x - x);
    if (d < dist) {
      dist = d;
      best = p.index;
    }
  }
  return best;
}

export interface MoveRow {
  moveNumber: number;
  white: AnalysedMove | null;
  black: AnalysedMove | null;
}

/** Score-sheet rows. A game that starts with Black to move gets a first row without a White move. */
export function moveRows(moves: readonly AnalysedMove[]): MoveRow[] {
  const rows: MoveRow[] = [];
  for (const m of moves) {
    let row = rows[rows.length - 1];
    if (!row || row.moveNumber !== m.moveNumber) {
      row = { moveNumber: m.moveNumber, white: null, black: null };
      rows.push(row);
    }
    if (m.color === 'w') row.white = m;
    else row.black = m;
  }
  return rows;
}

/** A UCI line as SAN, cut at `max` moves or at the first move that does not play. */
export function lineToSan(fen: string, pv: readonly string[], max = 8): string[] {
  const out: string[] = [];
  try {
    const chess = new Chess(fen);
    for (const uci of pv.slice(0, max)) out.push(chess.move(uciToMove(uci)).san);
  } catch {
    /* return what played */
  }
  return out;
}

/** Play one UCI move. Null when it is illegal. */
export function playUci(fen: string, uci: string): { fen: string; san: string; from: string; to: string } | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move(uciToMove(uci));
    return { fen: chess.fen(), san: m.san, from: m.from, to: m.to };
  } catch {
    return null;
  }
}

/** "1-0" -> "White won" etc. */
export function resultLabel(result: GameResult): string {
  if (result === '1-0') return 'White won';
  if (result === '0-1') return 'Black won';
  if (result === '1/2-1/2') return 'Draw';
  return 'Unfinished';
}

/** One decimal, or an en dash for null: 87.4 -> "87.4". */
export function formatAccuracy(value: number | null): string {
  return value === null ? '–' : value.toFixed(1);
}

/** Ply to show first: the URL's ?ply= when valid, else 0 (start position). `plyCount` = number of moves. */
export function initialPly(param: string | null, plyCount: number): number {
  const n = Number(param);
  return param !== null && Number.isInteger(n) && n >= 0 && n <= plyCount ? n : 0;
}
