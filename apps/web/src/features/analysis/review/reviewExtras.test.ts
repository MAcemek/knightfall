import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { ParsedGame } from '@knightfall/core';
import { barLabel, figurineSan, formatScore, lineSteps, moveHasIcon, moveLabel, provisionalMoves, soundKind, squarePos, swingOf, userSide } from './reviewExtras.ts';

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
