import type { AnalysedMove, EvalScore, ParsedGame } from '@knightfall/core';
import { playUci } from './reviewLogic.ts';

/** More pure helpers of the review page (no React, no IndexedDB). */

/** "+0.4", "-1.2", "M3", "-M3". */
export function formatScore(score: EvalScore | undefined): string {
  if (!score) return '–';
  if ('mate' in score) return score.mate > 0 ? `M${score.mate}` : `-M${Math.abs(score.mate)}`;
  const v = score.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

/** Label inside the eval bar: magnitude only ("0.4", "M3"), the bar itself shows who is ahead. */
export function barLabel(score: EvalScore | undefined): string {
  if (!score) return '';
  if ('mate' in score) return `M${Math.abs(score.mate)}`;
  return (Math.abs(score.cp) / 100).toFixed(1);
}

/** The side the user played, from the imported username; null when unknown. */
export function userSide(game: { white: { name: string }; black: { name: string }; importedFor?: string }): 'w' | 'b' | null {
  const me = game.importedFor?.trim().toLowerCase();
  if (!me) return null;
  const w = game.white.name.toLowerCase() === me;
  const b = game.black.name.toLowerCase() === me;
  return w === b ? null : w ? 'w' : 'b';
}

/** Column and row (0 = top/left of the screen) of a square for the given board orientation. */
export function squarePos(square: string, orientation: 'white' | 'black'): { col: number; row: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return orientation === 'white' ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
}

export function sideToMoveOf(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Moves of a parsed game without any classification (shown while the analysis is still running). */
export function provisionalMoves(parsed: ParsedGame): AnalysedMove[] {
  return parsed.sans.map((san, ply) => {
    const fenBefore = parsed.fens[ply];
    return {
      ply,
      color: sideToMoveOf(fenBefore),
      moveNumber: Number(fenBefore.split(' ')[5]) || Math.floor(ply / 2) + 1,
      san,
      uci: parsed.ucis[ply],
      fenBefore,
      fenAfter: parsed.fens[ply + 1],
      class: 'good',
      phase: 'opening',
      winBefore: 50,
      winAfter: 50,
      accuracy: 0,
      cpLoss: 0,
    };
  });
}

export type SoundKind = 'move' | 'capture' | 'check' | 'castle' | 'promote';

export function soundKind(san: string): SoundKind {
  if (san.includes('+') || san.includes('#')) return 'check';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('x')) return 'capture';
  if (san.includes('=')) return 'promote';
  return 'move';
}

export interface LineStep {
  fen: string;
  from: string;
  to: string;
  san: string;
}

/** Positions reached by playing a UCI line from `fen` (stops at the first illegal move). */
export function lineSteps(fen: string, pv: readonly string[], max = 8): LineStep[] {
  const out: LineStep[] = [];
  let cur = fen;
  for (const uci of pv.slice(0, max)) {
    const m = playUci(cur, uci);
    if (!m) break;
    out.push({ fen: m.fen, from: m.from, to: m.to, san: m.san });
    cur = m.fen;
  }
  return out;
}

/** "12. Nf3" / "12... Nf6". */
export function moveLabel(m: Pick<AnalysedMove, 'moveNumber' | 'color' | 'san'>): string {
  return `${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${m.san}`;
}

/** Win-chance swing of a move for the mover, in points (negative = lost). */
export function swingOf(m: Pick<AnalysedMove, 'winBefore' | 'winAfter'>): number {
  return Math.round((m.winAfter - m.winBefore) * 10) / 10;
}
