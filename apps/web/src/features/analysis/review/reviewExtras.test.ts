import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { ParsedGame, PositionEval } from '@knightfall/core';
import { barLabel, capitalise, figurineSan, formatScore, lineRows, lineSteps, reviewLine, moveHasIcon, moveLabel, provisionalMoves, soundKind, squarePos, swingOf, userSide } from './reviewExtras.ts';

describe('formatScore / barLabel', () => {
  it('formats centipawns and mates', () => {
    expect(formatScore({ cp: 40 })).toBe('+0.4');
    expect(formatScore({ cp: -120 })).toBe('-1.2');
    expect(formatScore({ cp: 0 })).toBe('0.0');
    expect(formatScore({ mate: 3 })).toBe('M3');
    expect(formatScore({ mate: -2 })).toBe('-M2');
    expect(formatScore(undefined)).toBe('–');
    expect(barLabel({ mate: -3 })).toBe('M3');
    expect(barLabel({ cp: -250 })).toBe('2.5');
    // A checkmated final position shows '#', not 'M1'.
    expect(formatScore({ mate: 1 }, 'checkmate')).toBe('#');
    expect(formatScore({ mate: -1 }, 'checkmate')).toBe('#');
    expect(barLabel({ mate: -1 }, 'checkmate')).toBe('#');
    expect(formatScore({ cp: 0 }, 'stalemate')).toBe('0.0');
  });
});

describe('userSide', () => {
  const g = { white: { name: 'Alice' }, black: { name: 'Bob' } };
  it('matches the imported username case-insensitively', () => {
    expect(userSide({ ...g, importedFor: 'alice' })).toBe('w');
    expect(userSide({ ...g, importedFor: 'BOB' })).toBe('b');
    expect(userSide({ ...g, importedFor: 'carol' })).toBeNull();
    expect(userSide(g)).toBeNull();
    expect(userSide({ white: { name: 'x' }, black: { name: 'X' }, importedFor: 'x' })).toBeNull();
  });
});

describe('squarePos', () => {
  it('maps squares to screen cells for both orientations', () => {
    expect(squarePos('a8', 'white')).toEqual({ col: 0, row: 0 });
    expect(squarePos('h1', 'white')).toEqual({ col: 7, row: 7 });
    expect(squarePos('a8', 'black')).toEqual({ col: 7, row: 7 });
    expect(squarePos('h1', 'black')).toEqual({ col: 0, row: 0 });
  });
});

describe('provisionalMoves', () => {
  it('builds unclassified moves with colours and numbers', () => {
    const c = new Chess();
    const fens = [c.fen()];
    const sans: string[] = [];
    const ucis: string[] = [];
    for (const s of ['e4', 'e5', 'Nf3']) {
      const m = c.move(s);
      sans.push(m.san);
      ucis.push(m.from + m.to);
      fens.push(c.fen());
    }
    const parsed = { sans, ucis, fens } as unknown as ParsedGame;
    const ms = provisionalMoves(parsed);
    expect(ms.map((m) => [m.color, m.moveNumber, m.san])).toEqual([['w', 1, 'e4'], ['b', 1, 'e5'], ['w', 2, 'Nf3']]);
    expect(ms[2].fenBefore).toBe(fens[2]);
  });
});

describe('soundKind', () => {
  it('picks a sound from the SAN', () => {
    expect(soundKind('e4')).toBe('move');
    expect(soundKind('Nxe5')).toBe('capture');
    expect(soundKind('Qh5+')).toBe('check');
    expect(soundKind('O-O')).toBe('castle');
    expect(soundKind('e8=Q')).toBe('promote');
  });
});

describe('lineSteps', () => {
  it('plays a line and stops at an illegal move', () => {
    const start = new Chess().fen();
    const steps = lineSteps(start, ['e2e4', 'e7e5', 'a1a8', 'g1f3']);
    expect(steps.map((s) => s.san)).toEqual(['e4', 'e5']);
    expect(steps[0]).toMatchObject({ from: 'e2', to: 'e4' });
    expect(lineSteps(start, ['e2e4', 'e7e5', 'g1f3'], 1)).toHaveLength(1);
  });
});

describe('moveLabel / swingOf', () => {
  it('labels moves and rounds swings', () => {
    expect(moveLabel({ moveNumber: 12, color: 'w', san: 'Nf3' })).toBe('12. Nf3');
    expect(moveLabel({ moveNumber: 12, color: 'b', san: 'Nf6' })).toBe('12... Nf6');
    expect(swingOf({ winBefore: 60, winAfter: 41.2 })).toBe(-18.8);
  });
});

describe('figurineSan', () => {
  it('replaces piece letters with figurines for the mover', () => {
    expect(figurineSan('Nf3', 'w')).toBe('\u2658f3');
    expect(figurineSan('Nf6', 'b')).toBe('\u265Ef6');
    expect(figurineSan('Qxd5+', 'b')).toBe('\u265Bxd5+');
    expect(figurineSan('e4', 'w')).toBe('e4');
    expect(figurineSan('O-O', 'w')).toBe('O-O');
    expect(figurineSan('exd8=Q#', 'w')).toBe('exd8=\u2655#');
  });
});

describe('moveHasIcon', () => {
  it('marks only the notable classes', () => {
    for (const c of ['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder'] as const) expect(moveHasIcon(c)).toBe(true);
    for (const c of ['best', 'excellent', 'good', 'book', 'forced'] as const) expect(moveHasIcon(c)).toBe(false);
  });
});

describe('lineRows', () => {
  it('labels moves with their numbers and adds a note each', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const { steps, rows } = lineRows(fen, ['g1f3', 'b8c6', 'f1b5']);
    expect(steps).toHaveLength(3);
    expect(rows.map((r) => r.label)).toEqual(['2. \u2658f3', '2... \u265Ec6', '3. \u2657b5']);
    expect(rows[0].note).toBe('threatens the pawn on e5');
    expect(rows[1].note).toBe('defends the pawn on e5');
  });
  it('starts a Black line with dots, and stops at an illegal move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const { rows } = lineRows(fen, ['e7e5', 'e7e5']);
    expect(rows.map((r) => r.label)).toEqual(['1... e5']);
  });
  it('keeps rows and steps the same length and caps the line', () => {
    const { steps, rows } = lineRows('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'], 4);
    expect(steps).toHaveLength(4);
    expect(rows).toHaveLength(4);
  });
});

describe('capitalise', () => {
  it('upper-cases the first letter', () => {
    expect(capitalise('takes the bishop')).toBe('Takes the bishop');
    expect(capitalise('')).toBe('');
  });
});

describe('reviewLine', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const ev = (fen: string, pv: string[]) => ({ fen, depth: 16, source: 'engine', lines: [{ score: { cp: 0 }, pv }], score: { cp: 0 } }) as PositionEval;
  const move = { ply: 0, fenBefore: start, fenAfter: afterE4 };
  const evals = [ev(start, ['d2d4', 'd7d5']), ev(afterE4, ['e7e5', 'g1f3', 'b8c6'])];

  it('Best starts from the position before the move, Explain from the one after it', () => {
    const best = reviewLine('best', move, evals);
    expect(best?.startFen).toBe(start);
    expect(best?.rows.map((r) => r.label)).toEqual(['1. d4', '1... d5']);
    const explain = reviewLine('explain', move, evals);
    expect(explain?.startFen).toBe(afterE4);
    expect(explain?.rows.map((r) => r.label)).toEqual(['1... e5', '2. \u2658f3', '2... \u265Ec6']);
    expect(explain?.steps).toHaveLength(3);
  });
  it('is null without a stored line or a playable first move', () => {
    expect(reviewLine('best', move, [])).toBeNull();
    expect(reviewLine('explain', move, [evals[0]])).toBeNull();
    expect(reviewLine('best', move, [ev(start, ['e7e5'])])).toBeNull();
  });
});
