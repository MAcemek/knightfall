import { describe, expect, it } from 'vitest';
import type { AnalysedMove, EvalScore, PositionEval } from '@knightfall/core';
import { barFraction, formatAccuracy, graphGeometry, initialPly, lineToSan, moveRows, nearestPoint, playUci, resultLabel } from './reviewLogic.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ev = (score: EvalScore): PositionEval => ({ fen: START, depth: 16, source: 'engine', lines: [], score });
const mv = (ply: number, color: 'w' | 'b', moveNumber: number): AnalysedMove => ({
  ply, color, moveNumber, san: 'x', uci: 'a1a2', fenBefore: START, fenAfter: START, class: 'good', phase: 'opening', winBefore: 50, winAfter: 50, accuracy: 100, cpLoss: 0,
});

describe('barFraction', () => {
  it('maps the score to White\'s share', () => {
    expect(barFraction(ev({ cp: 0 }))).toBe(0.5);
    expect(barFraction(ev({ mate: 2 }))).toBe(1);
    expect(barFraction(ev({ mate: -2 }))).toBe(0);
    expect(barFraction(ev({ cp: 300 }))).toBeGreaterThan(0.7);
    expect(barFraction(undefined)).toBe(0.5);
  });
});

describe('graphGeometry', () => {
  it('spreads positions over the width and puts White advantage at the top', () => {
    const g = graphGeometry([ev({ cp: 0 }), ev({ mate: 1 }), ev({ mate: -1 })], 100, 50, 0);
    expect(g.points).toEqual([{ index: 0, x: 0, y: 25 }, { index: 1, x: 50, y: 0 }, { index: 2, x: 100, y: 50 }]);
    expect(g.line).toBe('M0 25 L50 0 L100 50');
    expect(g.area).toBe('M0 25 L50 0 L100 50 L100 50 L0 50 Z');
    expect(g.midY).toBe(25);
  });
  it('breaks the curve at unknown positions', () => {
    const g = graphGeometry([ev({ cp: 0 }), undefined, ev({ cp: 0 }), ev({ cp: 0 })], 90, 40, 0);
    expect(g.points[1]).toBeNull();
    expect(g.line).toBe('M0 20 M60 20 L90 20');
    expect(g.area.match(/Z/g)).toHaveLength(2);
  });
  it('handles empty and single-position input and applies padding', () => {
    expect(graphGeometry([], 100, 50)).toMatchObject({ points: [], line: '', area: '' });
    expect(graphGeometry([ev({ cp: 0 })], 100, 50, 10).points[0]).toEqual({ index: 0, x: 50, y: 25 });
    const g = graphGeometry([ev({ mate: 1 }), ev({ mate: -1 })], 100, 50, 10);
    expect(g.points).toEqual([{ index: 0, x: 10, y: 10 }, { index: 1, x: 90, y: 40 }]);
  });
});

describe('nearestPoint', () => {
  it('picks the closest known point', () => {
    const g = graphGeometry([ev({ cp: 0 }), undefined, ev({ cp: 0 })], 100, 50, 0);
    expect(nearestPoint(g.points, 10)).toBe(0);
    expect(nearestPoint(g.points, 55)).toBe(2);
    expect(nearestPoint([null, null], 5)).toBeNull();
  });
});

describe('moveRows', () => {
  it('pairs moves by move number', () => {
    const rows = moveRows([mv(0, 'w', 1), mv(1, 'b', 1), mv(2, 'w', 2)]);
    expect(rows.map((r) => [r.moveNumber, r.white?.ply ?? null, r.black?.ply ?? null])).toEqual([[1, 0, 1], [2, 2, null]]);
  });
  it('leaves White empty when Black moves first', () => {
    const rows = moveRows([mv(0, 'b', 40), mv(1, 'w', 41), mv(2, 'b', 41)]);
    expect(rows.map((r) => [r.moveNumber, r.white?.ply ?? null, r.black?.ply ?? null])).toEqual([[40, null, 0], [41, 1, 2]]);
  });
});

describe('lines and moves', () => {
  it('lineToSan converts and stops at an illegal move or the limit', () => {
    expect(lineToSan(START, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(lineToSan(START, ['e2e4', 'e2e4', 'e7e5'])).toEqual(['e4']);
    expect(lineToSan(START, ['e2e4', 'e7e5', 'g1f3'], 2)).toEqual(['e4', 'e5']);
    expect(lineToSan('junk', ['e2e4'])).toEqual([]);
  });
  it('playUci plays a legal move and rejects an illegal one', () => {
    expect(playUci(START, 'g1f3')).toMatchObject({ san: 'Nf3', from: 'g1', to: 'f3' });
    expect(playUci(START, 'g1f3')!.fen.split(' ')[1]).toBe('b');
    expect(playUci(START, 'e2e5')).toBeNull();
  });
});

describe('labels', () => {
  it('resultLabel, formatAccuracy, initialPly', () => {
    expect(resultLabel('1-0')).toBe('White won');
    expect(resultLabel('0-1')).toBe('Black won');
    expect(resultLabel('1/2-1/2')).toBe('Draw');
    expect(resultLabel('*')).toBe('Unfinished');
    expect(formatAccuracy(87.44)).toBe('87.4');
    expect(formatAccuracy(null)).toBe('–');
    expect(initialPly('12', 40)).toBe(12);
    expect(initialPly('40', 40)).toBe(40);
    expect(initialPly('41', 40)).toBe(0);
    expect(initialPly('-1', 40)).toBe(0);
    expect(initialPly('abc', 40)).toBe(0);
    expect(initialPly(null, 40)).toBe(0);
  });
});
