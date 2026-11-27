import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { classifyMove, pointLossClass, type ClassifyContext } from './classify.ts';
import { epMoveAccuracy, expectedPoints, expectedPointsLoss, subjectiveValue } from './expectedPoints.ts';
import type { EvalScore, MoveClass, PositionEval, Side } from './types.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('expected points', () => {
  it('is the logistic of the centipawns (White view)', () => {
    expect(expectedPoints({ cp: 0 })).toBe(0.5);
    expect(expectedPoints({ cp: 100 })).toBeCloseTo(1 / (1 + Math.exp(-0.35)), 12);
    expect(expectedPoints({ cp: 100 })).toBeCloseTo(0.5866, 4);
    expect(expectedPoints({ cp: 100 }) + expectedPoints({ cp: -100 })).toBeCloseTo(1, 12);
    expect(expectedPoints({ cp: 2000 })).toBeGreaterThan(0.999);
  });
  it('maps mate scores to 1 or 0, and a terminal mate to the mover', () => {
    expect(expectedPoints({ mate: 3 })).toBe(1);
    expect(expectedPoints({ mate: -3 })).toBe(0);
    expect(expectedPoints({ mate: 0 }, 'w')).toBe(1);
    expect(expectedPoints({ mate: 0 }, 'b')).toBe(0);
    expect(expectedPoints({ mate: 0 })).toBe(1);
  });
  it('subjectiveValue flips the sign for Black', () => {
    expect(subjectiveValue({ cp: 120 }, 'w')).toBe(120);
    expect(subjectiveValue({ cp: 120 }, 'b')).toBe(-120);
    expect(subjectiveValue({ mate: -2 }, 'b')).toBe(2);
  });
  it('loss is what the mover gave away, never negative', () => {
    expect(expectedPointsLoss({ cp: 100 }, { cp: -100 }, 'w')).toBeCloseTo(0.5866 - 0.4134, 4);
    expect(expectedPointsLoss({ cp: -100 }, { cp: 100 }, 'b')).toBeCloseTo(0.5866 - 0.4134, 4);
    expect(expectedPointsLoss({ cp: 0 }, { cp: 300 }, 'w')).toBe(0);
    expect(expectedPointsLoss({ cp: 0 }, { cp: -300 }, 'b')).toBe(0);
    expect(expectedPointsLoss({ cp: 100 }, { cp: 100 }, 'w')).toBe(0);
  });
  it('loss handles mate scores', () => {
    expect(expectedPointsLoss({ mate: 2 }, { cp: 0 }, 'w')).toBe(0.5);
    expect(expectedPointsLoss({ cp: 0 }, { mate: -2 }, 'w')).toBe(0.5);
    expect(expectedPointsLoss({ mate: 2 }, { mate: -2 }, 'w')).toBe(1);
    expect(expectedPointsLoss({ mate: -2 }, { mate: 2 }, 'b')).toBe(1);
    // Giving checkmate: the mover's side scores a full point.
    expect(expectedPointsLoss({ mate: 1 }, { mate: 0 }, 'w')).toBe(0);
    expect(expectedPointsLoss({ mate: -1 }, { mate: 0 }, 'b')).toBe(0);
  });
  it('move accuracy is 103.16·e^(−4·loss) − 3.17', () => {
    expect(epMoveAccuracy(0)).toBeCloseTo(99.99, 6);
    expect(epMoveAccuracy(0.1)).toBeCloseTo(103.16 * Math.exp(-0.4) - 3.17, 10);
    expect(epMoveAccuracy(0.1)).toBeCloseTo(65.97, 1);
    expect(epMoveAccuracy(1)).toBeCloseTo(-1.28, 2);
  });
});

describe('pointLossClass: centipawn to centipawn bands (from cp 0, White)', () => {
  // Losing x cp from an equal position loses 0.01 / 0.045 / 0.08 / 0.12 / 0.22 expected points at about
  // x = 12 / 52 / 93 / 140 / 270.
  const cases: [number, MoveClass][] = [
    [0, 'best'], [11, 'best'], [12, 'excellent'], [51, 'excellent'], [52, 'good'], [92, 'good'],
    [93, 'inaccuracy'], [139, 'inaccuracy'], [140, 'mistake'], [269, 'mistake'], [270, 'blunder'], [900, 'blunder'],
  ];
  it.each(cases)('losing %i cp is %s', (x, cls) => {
    expect(pointLossClass({ cp: 0 }, { cp: -x }, 'w')).toBe(cls);
  });
  it('gaining ground is best, and Black is the mirror image', () => {
    expect(pointLossClass({ cp: 0 }, { cp: 80 }, 'w')).toBe('best');
    for (const [x, cls] of cases) expect(pointLossClass({ cp: 0 }, { cp: x }, 'b')).toBe(cls);
  });
  it('bands sit exactly on the documented loss thresholds', () => {
    const loss = (x: number) => expectedPointsLoss({ cp: 0 }, { cp: -x }, 'w');
    expect(loss(11)).toBeLessThan(0.01);
    expect(loss(12)).toBeGreaterThanOrEqual(0.01);
    expect(loss(51)).toBeLessThan(0.045);
    expect(loss(52)).toBeGreaterThanOrEqual(0.045);
    expect(loss(92)).toBeLessThan(0.08);
    expect(loss(93)).toBeGreaterThanOrEqual(0.08);
    expect(loss(139)).toBeLessThan(0.12);
    expect(loss(140)).toBeGreaterThanOrEqual(0.12);
    expect(loss(269)).toBeLessThan(0.22);
    expect(loss(270)).toBeGreaterThanOrEqual(0.22);
  });
});

describe('pointLossClass: mate to mate', () => {
  it('losing the mate: a blunder, or a mistake when the opponent now mates in more than 3', () => {
    expect(pointLossClass({ mate: 3 }, { mate: -2 }, 'w')).toBe('blunder');
    expect(pointLossClass({ mate: 3 }, { mate: -3 }, 'w')).toBe('blunder');
    expect(pointLossClass({ mate: 3 }, { mate: -4 }, 'w')).toBe('mistake');
    expect(pointLossClass({ mate: -3 }, { mate: 4 }, 'b')).toBe('mistake');
    expect(pointLossClass({ mate: -3 }, { mate: 3 }, 'b')).toBe('blunder');
  });
  it('mate distance: shorter or equal-while-losing is best', () => {
    expect(pointLossClass({ mate: 5 }, { mate: 3 }, 'w')).toBe('best');
    expect(pointLossClass({ mate: -5 }, { mate: -3 }, 'b')).toBe('best');
    // Being mated either way in the same number of moves: nothing was lost.
    expect(pointLossClass({ mate: -3 }, { mate: -3 }, 'w')).toBe('best');
  });
  it('slower mates: 0-1 moves excellent, 2-6 good, 7+ inaccuracy', () => {
    expect(pointLossClass({ mate: 3 }, { mate: 3 }, 'w')).toBe('excellent');
    expect(pointLossClass({ mate: 3 }, { mate: 4 }, 'w')).toBe('excellent');
    expect(pointLossClass({ mate: 3 }, { mate: 5 }, 'w')).toBe('good');
    expect(pointLossClass({ mate: 3 }, { mate: 9 }, 'w')).toBe('good');
    expect(pointLossClass({ mate: 3 }, { mate: 10 }, 'w')).toBe('inaccuracy');
    expect(pointLossClass({ mate: -3 }, { mate: -10 }, 'b')).toBe('inaccuracy');
    expect(pointLossClass({ mate: -3 }, { mate: -5 }, 'b')).toBe('good');
  });
});

describe('pointLossClass: mate to centipawns', () => {
  const cases: [number, MoveClass][] = [
    [2000, 'excellent'], [800, 'excellent'], [799, 'good'], [400, 'good'], [399, 'inaccuracy'], [200, 'inaccuracy'],
    [199, 'mistake'], [0, 'mistake'], [-1, 'blunder'], [-900, 'blunder'],
  ];
  it.each(cases)('after a missed mate, %i cp for the mover is %s', (cp, cls) => {
    expect(pointLossClass({ mate: 2 }, { cp }, 'w')).toBe(cls);
    expect(pointLossClass({ mate: -2 }, { cp: -cp }, 'b')).toBe(cls);
  });
});

describe('pointLossClass: centipawns to mate', () => {
  it('finding a mate is best', () => {
    expect(pointLossClass({ cp: 50 }, { mate: 4 }, 'w')).toBe('best');
    expect(pointLossClass({ cp: -50 }, { mate: -4 }, 'b')).toBe('best');
  });
  it('walking into one: mate in 1-2 blunder, 3-5 mistake, 6+ inaccuracy', () => {
    expect(pointLossClass({ cp: 0 }, { mate: -1 }, 'w')).toBe('blunder');
    expect(pointLossClass({ cp: 0 }, { mate: -2 }, 'w')).toBe('blunder');
    expect(pointLossClass({ cp: 0 }, { mate: -3 }, 'w')).toBe('mistake');
    expect(pointLossClass({ cp: 0 }, { mate: -5 }, 'w')).toBe('mistake');
    expect(pointLossClass({ cp: 0 }, { mate: -6 }, 'w')).toBe('inaccuracy');
    expect(pointLossClass({ cp: 0 }, { mate: 2 }, 'b')).toBe('blunder');
    expect(pointLossClass({ cp: 0 }, { mate: 6 }, 'b')).toBe('inaccuracy');
  });
});

/* ---------- classifyMove ---------- */

const ev = (fen: string, score: EvalScore, ...lines: [EvalScore, string][]): PositionEval => ({
  fen,
  depth: 16,
  source: 'engine',
  score,
  lines: lines.map(([s, pv]) => ({ score: s, pv: [pv] })),
});

/** Context for playing `uci` from `fenBefore` with hand-made evaluations (White's view). */
function ctx(
  fenBefore: string,
  uci: string,
  o: { before: EvalScore; lines: [EvalScore, string][]; after: EvalScore; book?: boolean; previous?: MoveClass },
): ClassifyContext {
  const chess = new Chess(fenBefore);
  const mover: Side = chess.turn();
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const fenAfter = chess.fen();
  return {
    fenBefore, fenAfter, uci, mover,
    before: ev(fenBefore, o.before, ...o.lines),
    after: ev(fenAfter, o.after),
    isBook: o.book ?? false,
    previous: o.previous,
  };
}

const E4 = 'e2e4';
const D4: [EvalScore, string] = [{ cp: 0 }, 'd2d4'];

describe('classifyMove: forced, book, checkmate, best', () => {
  const lone = 'k7/8/8/8/8/8/1q6/K7 w - - 0 1'; // only Kxb2
  it('a single legal move is forced, even in a known position', () => {
    const c = ctx(lone, 'a1b2', { before: { cp: -900 }, lines: [[{ cp: -900 }, 'a1b2']], after: { cp: 0 }, book: true });
    expect(classifyMove(c)).toBe('forced');
    expect(classifyMove({ ...c, after: ev(c.fenAfter, { cp: -900 }) })).toBe('forced');
  });
  it('a known opening position is book, whatever the engine says', () => {
    expect(classifyMove(ctx(START, E4, { before: { cp: 0 }, lines: [D4], after: { cp: -500 }, book: true }))).toBe('book');
  });
  it('checkmate is best even if the engine lines were different', () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const c = ctx(fen, 'h5f7', { before: { mate: 1 }, lines: [[{ mate: 1 }, 'h5e5']], after: { mate: 0 } });
    expect(classifyMove(c)).toBe('best');
  });
  it("the engine's first choice is best, whatever the numbers", () => {
    expect(classifyMove(ctx(START, E4, { before: { cp: 0 }, lines: [[{ cp: 0 }, E4]], after: { cp: -300 } }))).toBe('best');
  });
  it('falls back to the loss class when the move cannot be replayed', () => {
    const c = ctx(START, E4, { before: { cp: 0 }, lines: [D4], after: { cp: -100 } });
    expect(classifyMove({ ...c, uci: 'a1a8' })).toBe('inaccuracy');
  });
});

describe('classifyMove: each loss band when the top move was not played', () => {
  const cases: [number, MoveClass][] = [[5, 'best'], [30, 'excellent'], [70, 'good'], [110, 'inaccuracy'], [200, 'mistake'], [400, 'blunder']];
  it.each(cases)('losing %i cp is %s', (x, cls) => {
    expect(classifyMove(ctx(START, E4, { before: { cp: 0 }, lines: [D4], after: { cp: -x } }))).toBe(cls);
  });
  it('works for Black', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(classifyMove(ctx(fen, 'e7e5', { before: { cp: 0 }, lines: [[{ cp: 0 }, 'd7d5']], after: { cp: 200 } }))).toBe('mistake');
  });
});

describe('classifyMove: great', () => {
  const only: [EvalScore, string][] = [[{ cp: 100 }, E4], [{ cp: -100 }, 'd2d4']]; // second line loses 0.17
  it('the top move whose alternative loses at least 0.10 expected points', () => {
    expect(classifyMove(ctx(START, E4, { before: { cp: 100 }, lines: only, after: { cp: 100 } }))).toBe('great');
  });
  it('boundary: second line losing under 0.10 is just best', () => {
    // EP(100) - EP(20) = 0.587 - 0.518 = 0.069
    expect(classifyMove(ctx(START, E4, { before: { cp: 100 }, lines: [[{ cp: 100 }, E4], [{ cp: 20 }, 'd2d4']], after: { cp: 100 } }))).toBe('best');
    // EP(100) - EP(-17) = 0.587 - 0.485 = 0.102
    expect(classifyMove(ctx(START, E4, { before: { cp: 100 }, lines: [[{ cp: 100 }, E4], [{ cp: -17 }, 'd2d4']], after: { cp: 100 } }))).toBe('great');
  });
  it('is not great when there is no second line', () => {
    expect(classifyMove(ctx(START, E4, { before: { cp: 100 }, lines: [[{ cp: 100 }, E4]], after: { cp: 100 } }))).toBe('best');
  });
  it('is not great when the second line is still winning by 700+', () => {
    const c = ctx(START, E4, { before: { cp: 1500 }, lines: [[{ cp: 1500 }, E4], [{ cp: 700 }, 'd2d4']], after: { cp: 1500 } });
    expect(classifyMove(c)).toBe('best');
  });
  it('is not great when there is no second line and the position is already +700', () => {
    expect(classifyMove(ctx(START, E4, { before: { cp: 900 }, lines: [[{ cp: 900 }, E4]], after: { cp: 900 } }))).toBe('best');
  });
  it('is not great when the mover is worse afterwards', () => {
    const c = ctx(START, E4, { before: { cp: -50 }, lines: [[{ cp: -50 }, E4], [{ cp: -400 }, 'd2d4']], after: { cp: -50 } });
    expect(classifyMove(c)).toBe('best');
  });
  it('is not great when it just captures a piece that was hanging', () => {
    const hang = '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1';
    const c = ctx(hang, 'd1d5', { before: { cp: 300 }, lines: [[{ cp: 300 }, 'd1d5'], [{ cp: -100 }, 'e1e2']], after: { cp: 300 } });
    expect(classifyMove(c)).toBe('best');
    // A defended knight (equal trade) is not free material: the capture can be great.
    const guarded = '4k3/8/4p3/3n4/8/2N5/8/4K3 w - - 0 1';
    const g = ctx(guarded, 'c3d5', { before: { cp: 300 }, lines: [[{ cp: 300 }, 'c3d5'], [{ cp: -100 }, 'e1e2']], after: { cp: 300 } });
    expect(classifyMove(g)).toBe('great');
  });
  it('is not great when the move finds a winning mate', () => {
    const c = ctx(START, E4, { before: { mate: 3 }, lines: [[{ mate: 3 }, E4], [{ cp: -100 }, 'd2d4']], after: { mate: 2 } });
    expect(classifyMove(c)).toBe('best');
  });
  it('is not great when the mover was in check before the move', () => {
    const check = '7k/8/8/8/8/8/8/K1r5 w - - 0 1';
    const c = ctx(check, 'a1a2', { before: { cp: 100 }, lines: [[{ cp: 100 }, 'a1a2'], [{ cp: -300 }, 'a1b2']], after: { cp: 100 } });
    expect(classifyMove(c)).toBe('best');
  });
  it('is not great for a queen promotion', () => {
    const promo = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    const c = ctx(promo, 'a7a8q', { before: { cp: 100 }, lines: [[{ cp: 100 }, 'a7a8q'], [{ cp: -300 }, 'a1b2']], after: { cp: 100 } });
    expect(classifyMove(c)).toBe('best');
  });
});

describe('classifyMove: brilliant', () => {
  // Légal's mate setup: 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6, then 5.Nxe5! leaves the queen to Bxd1 (Bxf7+ and Nd5#).
  const legal = 'rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5';
  const nxe5 = 'f3e5';
  it('a best move that leaves a piece en prise which cannot be taken safely', () => {
    const c = ctx(legal, nxe5, { before: { cp: 30 }, lines: [[{ cp: 30 }, nxe5], [{ cp: -50 }, 'd2d4']], after: { cp: 60 } });
    expect(classifyMove(c)).toBe('brilliant');
  });
  it('also when the played move is only within the best band', () => {
    const c = ctx(legal, nxe5, { before: { cp: 40 }, lines: [[{ cp: 40 }, 'd2d4']], after: { cp: 30 } });
    expect(classifyMove(c)).toBe('brilliant');
  });
  it('not when the move is merely excellent', () => {
    const c = ctx(legal, nxe5, { before: { cp: 60 }, lines: [[{ cp: 60 }, 'd2d4']], after: { cp: 30 } });
    expect(classifyMove(c)).toBe('excellent');
  });
  it('not when the position was already won, or the sacrifice leaves the mover worse', () => {
    const won = ctx(legal, nxe5, { before: { cp: 900 }, lines: [[{ cp: 900 }, nxe5], [{ cp: 800 }, 'd2d4']], after: { cp: 900 } });
    expect(classifyMove(won)).toBe('best');
    const worse = ctx(legal, nxe5, { before: { cp: -30 }, lines: [[{ cp: -30 }, nxe5], [{ cp: -50 }, 'd2d4']], after: { cp: -30 } });
    expect(classifyMove(worse)).toBe('best');
  });
  it('not when a piece simply moves out of danger', () => {
    const fen = '4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1'; // Ne4 hangs to ...d5xe4
    const c = ctx(fen, 'e4g3', { before: { cp: 300 }, lines: [[{ cp: 300 }, 'e4g3'], [{ cp: 290 }, 'e1e2']], after: { cp: 300 } });
    expect(classifyMove(c)).toBe('best');
  });
  it('not for a plain recapture', () => {
    const fen = '4k3/8/8/8/4n3/3P4/8/4K3 w - - 0 1';
    const c = ctx(fen, 'd3e4', { before: { cp: 300 }, lines: [[{ cp: 300 }, 'd3e4'], [{ cp: 290 }, 'e1e2']], after: { cp: 300 } });
    expect(classifyMove(c)).toBe('best');
  });
  it('not for a promotion', () => {
    const promo = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    const knight = ctx(promo, 'a7a8n', { before: { cp: 100 }, lines: [[{ cp: 100 }, 'a7a8n'], [{ cp: 90 }, 'a1b1']], after: { cp: 100 } });
    expect(classifyMove(knight)).toBe('best');
  });
});

describe('classifyMove: miss (Knightfall)', () => {
  const lines: [EvalScore, string][] = [[{ cp: 200 }, 'd2d4']];
  it('the opponent just slipped and you let the chance go while still doing fine', () => {
    // 200 -> 100: loses 0.081 (inaccuracy); the mover still has 0.587 expected points.
    expect(classifyMove(ctx(START, E4, { before: { cp: 200 }, lines, after: { cp: 100 }, previous: 'blunder' }))).toBe('miss');
    expect(classifyMove(ctx(START, E4, { before: { cp: 200 }, lines, after: { cp: 100 }, previous: 'mistake' }))).toBe('miss');
  });
  it('also replaces a mistake or blunder of your own while you are still fine', () => {
    expect(classifyMove(ctx(START, E4, { before: { cp: 600 }, lines: [[{ cp: 600 }, 'd2d4']], after: { cp: 100 }, previous: 'blunder' }))).toBe('miss');
  });
  it('does not apply after an ordinary previous move', () => {
    for (const previous of ['best', 'good', 'inaccuracy', 'book', undefined] as (MoveClass | undefined)[]) {
      expect(classifyMove(ctx(START, E4, { before: { cp: 200 }, lines, after: { cp: 100 }, previous }))).toBe('inaccuracy');
    }
  });
  it('does not apply when the mover is already worse (expected points < 0.45)', () => {
    expect(classifyMove(ctx(START, E4, { before: { cp: 0 }, lines: [D4], after: { cp: -100 }, previous: 'blunder' }))).toBe('inaccuracy');
  });
  it('does not apply to a good move', () => {
    expect(classifyMove(ctx(START, E4, { before: { cp: 200 }, lines, after: { cp: 190 }, previous: 'blunder' }))).toBe('best');
  });
  it('works for Black', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const c = ctx(fen, 'e7e5', { before: { cp: -200 }, lines: [[{ cp: -200 }, 'd7d5']], after: { cp: -100 }, previous: 'blunder' });
    expect(classifyMove(c)).toBe('miss');
  });
});
