import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { moveInsight, type InsightContext, type MoveInsight } from './insight.ts';
import { buildReport } from './report.ts';
import type { EngineLine, EvalScore, MoveClass, PositionEval, Side } from './types.ts';

const line = (cp: number | { mate: number }, ...pv: string[]): EngineLine => ({
  score: typeof cp === 'number' ? { cp } : cp,
  pv,
});
const ev = (fen: string, ...lines: EngineLine[]): PositionEval => ({ fen, depth: 16, source: 'engine', lines, score: lines[0]?.score ?? { mate: 1 } });

/** Every FEN used here must be legal: both kings, and the side NOT to move is not in check. */
function legal(fen: string): string {
  const c = new Chess(fen);
  const parts = fen.split(' ');
  const other = new Chess(`${parts[0]} ${parts[1] === 'w' ? 'b' : 'w'} - - 0 1`);
  expect(other.isCheck(), `side not to move is in check: ${fen}`).toBe(false);
  expect(c.board().flat().filter((p) => p?.type === 'k')).toHaveLength(2);
  return fen;
}

/** Plays `uci` from fenBefore and returns the context pieces that depend on the board. */
function ctx(
  fenBefore: string,
  uci: string,
  cls: MoveClass,
  before: PositionEval,
  afterLines: EngineLine[],
  mover: Side = 'w',
): InsightContext {
  const c = new Chess(legal(fenBefore));
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const fenAfter = legal(c.fen());
  return { fenBefore, fenAfter, uci, mover, class: cls, evalBefore: before, evalAfter: ev(fenAfter, ...afterLines) };
}
const motif = (c: InsightContext): MoveInsight => moveInsight(c);

describe('stops-mate only when the mate can be stopped', () => {
  const fen = '6k1/8/8/8/8/5q2/6PP/7K w - - 0 1';
  it('is not claimed when the mover was already being mated', () => {
    const c = ctx(fen, 'h2h3', 'inaccuracy', ev(fen, line({ mate: -10 }, 'h1g1'), line({ mate: -2 }, 'h2h3')), [line({ mate: -2 }, 'f3g2')], 'w');
    expect(motif(c).best).toBeDefined();
    expect(motif(c).best?.reason).not.toBe('stops-mate');
  });
});

// White Ke1 + Ne3 against Ke8 + pawn d5: Nc4 walks onto a pawn's square.
const KNIGHT_E3 = '4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1';
// A knight on e4 attacked by the pawn d5; Kd1 leaves it there.
const KNIGHT_E4 = '4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1';
const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
const ROOK_FREE = '4k3/8/8/8/2r5/8/8/4KB2 w - - 0 1';

describe('hangs-piece', () => {
  it('names a piece moved onto an attacked square and the reply that takes it', () => {
    const c = ctx(KNIGHT_E3, 'e3c4', 'blunder', ev(KNIGHT_E3, line(30, 'e1d2')), [line(-300, 'd5c4', 'e1d2')]);
    expect(motif(c)).toMatchObject({
      motif: 'hangs-piece', piece: 'n', square: 'c4', material: 3, replySan: 'dxc4', threat: { from: 'd5', to: 'c4' },
    });
  });
  it('also catches a piece left behind (square is not the move target)', () => {
    const c = ctx(KNIGHT_E4, 'e1d1', 'mistake', ev(KNIGHT_E4, line(0, 'e4g3')), [line(-300, 'd5e4', 'd1c2')]);
    const r = motif(c);
    expect(r).toMatchObject({ motif: 'hangs-piece', piece: 'n', square: 'e4', replySan: 'dxe4' });
    // ...and the best move saves it.
    expect(r.best).toMatchObject({ reason: 'saves-piece', piece: 'n', square: 'g3' });
  });
  it('is not claimed when the piece is adequately defended', () => {
    const fen = '4k3/8/4b3/8/8/1P2N3/8/4K3 w - - 0 1';
    const c = ctx(fen, 'e3c4', 'inaccuracy', ev(fen, line(30, 'e1d2')), [line(0, 'e6c4', 'b3c4')]);
    expect(motif(c).motif).toBe('drifts');
  });
  it('is not claimed when the best reply does not take the piece', () => {
    const c = ctx(KNIGHT_E3, 'e3c4', 'inaccuracy', ev(KNIGHT_E3, line(30, 'e1d2')), [line(-20, 'e8d7', 'e1d2')]);
    expect(motif(c).motif).not.toBe('hangs-piece');
  });
});

describe('mates', () => {
  it('allows-mate names the mating reply', () => {
    const fen = '3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'; // black Rd8 is ready to mate on d1
    const c = ctx(fen, 'a1a2', 'blunder', ev(fen, line(0, 'a1a8')), [line({ mate: -1 }, 'd8d1')]);
    expect(motif(c)).toMatchObject({ motif: 'allows-mate', mateIn: 1, replySan: 'Rd1#', threat: { from: 'd8', to: 'd1' } });
  });
  it('is not claimed when the mate is for the mover', () => {
    const fen = '3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
    const c = ctx(fen, 'a1a2', 'inaccuracy', ev(fen, line(0, 'a1a8')), [line({ mate: 3 }, 'd8d1')]);
    expect(motif(c).motif).not.toBe('allows-mate');
  });
  it('misses-mate when a mate in 1 was on the board', () => {
    const c = ctx(BACK_RANK, 'g1h1', 'blunder', ev(BACK_RANK, line({ mate: 1 }, 'a1a8')), [line(0, 'g8f8')]);
    const r = motif(c);
    expect(r).toMatchObject({ motif: 'misses-mate', mateIn: 1 });
    expect(r.best).toEqual({ reason: 'mates', mateIn: 1 });
  });
  it('does not miss a mate when the played move keeps a mate', () => {
    const c = ctx(BACK_RANK, 'g1h1', 'inaccuracy', ev(BACK_RANK, line({ mate: 1 }, 'a1a8')), [line({ mate: 2 }, 'g8f8')]);
    expect(motif(c).motif).not.toBe('misses-mate');
  });
});

describe('misses-free-piece', () => {
  it('flags an unprotected rook the best move would have won', () => {
    const c = ctx(ROOK_FREE, 'e1d1', 'mistake', ev(ROOK_FREE, line(500, 'f1c4', 'e8d7')), [line(0, 'e8d7')]);
    const r = motif(c);
    expect(r).toMatchObject({ motif: 'misses-free-piece', piece: 'r', square: 'c4', material: 5 });
    expect(r.best).toMatchObject({ reason: 'wins-piece', piece: 'r', square: 'c4' });
  });
  it('is not claimed when the target is defended well enough', () => {
    const fen = '4k3/8/8/1p6/2n5/8/8/4KB2 w - - 0 1';
    const c = ctx(fen, 'e1d1', 'mistake', ev(fen, line(0, 'f1c4', 'b5c4')), [line(0, 'e8d7')]);
    expect(motif(c).motif).not.toBe('misses-free-piece');
  });
});

describe('material along the engine line', () => {
  const FEN = '4k3/8/8/4p3/8/8/3N4/4K3 w - - 0 1';
  it('loses-material when the line costs a piece a couple of moves later', () => {
    const c = ctx(FEN, 'e1f1', 'blunder', ev(FEN, line(0, 'e1d1')), [line(-300, 'e5e4', 'd2f3', 'e4f3', 'f1g1')]);
    expect(motif(c)).toMatchObject({ motif: 'loses-material', material: 3, replySan: 'e4' });
  });
  it('points the threat arrow at the capture, not at a quiet first reply', () => {
    const c = ctx(FEN, 'e1f1', 'blunder', ev(FEN, line(0, 'e1d1')), [line(-300, 'e5e4', 'd2f3', 'e4f3', 'f1g1')]);
    expect(motif(c).threat).toEqual({ from: 'e4', to: 'f3' });
  });
  it('is not claimed when the line is even', () => {
    const c = ctx(FEN, 'e1f1', 'inaccuracy', ev(FEN, line(0, 'e1d1')), [line(-30, 'e5e4', 'f1g1', 'e4e3', 'g1f2')]);
    expect(motif(c).motif).toBe('drifts');
  });
  const MISS = '4k3/8/2r5/8/8/5N2/8/4K3 w - - 0 1';
  it('misses-material when the best line wins material the played move does not', () => {
    const c = ctx(MISS, 'e1d1', 'mistake', ev(MISS, line(300, 'f3d4', 'e8d7', 'd4c6', 'd7c6')), [line(0, 'e8d7')]);
    expect(motif(c)).toMatchObject({ motif: 'misses-material', material: 2 });
  });
  it('is not claimed when the best line gains nothing', () => {
    const c = ctx(MISS, 'e1d1', 'inaccuracy', ev(MISS, line(0, 'f3d4', 'e8d7')), [line(0, 'e8d7')]);
    expect(motif(c).motif).toBe('drifts');
  });
});

describe('walks-into-fork', () => {
  const FEN = '7k/8/8/8/3n4/8/4R3/K7 w - - 0 1'; // Nd4 attacks the rook on e2; Re1 steps into Nc2+
  it('needs two targets and a line that collects one', () => {
    const c = ctx(FEN, 'e2e1', 'blunder', ev(FEN, line(0, 'e2a2')), [line(-500, 'd4c2', 'a1b1', 'c2e1', 'b1c1')]);
    expect(motif(c)).toMatchObject({ motif: 'walks-into-fork', piece: 'n', square: 'c2', replySan: 'Nc2+', threat: { from: 'd4', to: 'c2' } });
  });
  it('is not claimed when the line wins nothing', () => {
    const c = ctx(FEN, 'e2e1', 'inaccuracy', ev(FEN, line(0, 'e2a2')), [line(-20, 'd4c2', 'a1b1')]);
    expect(motif(c).motif).toBe('drifts');
  });
});

describe('fallbacks', () => {
  const FEN = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
  it('lets-off-hook for a miss with nothing verified', () => {
    expect(motif(ctx(FEN, 'e1d1', 'miss', ev(FEN, line(300, 'e2e4')), [line(0, 'e8d7')])).motif).toBe('lets-off-hook');
  });
  it('throws-win when a winning position is given up, drifts otherwise', () => {
    expect(motif(ctx(FEN, 'e1d1', 'blunder', ev(FEN, line(400, 'e2e4')), [line(100, 'e8d7')])).motif).toBe('throws-win');
    expect(motif(ctx(FEN, 'e1d1', 'mistake', ev(FEN, line(100, 'e2e4')), [line(-50, 'e8d7')])).motif).toBe('drifts');
  });
  it('returns none when the move cannot be replayed', () => {
    const c = ctx(FEN, 'e1d1', 'blunder', ev(FEN, line(0, 'e2e4')), [line(0, 'e8d7')]);
    expect(moveInsight({ ...c, uci: 'a1a8' }).motif).toBe('none');
  });
});

describe('good moves', () => {
  it('sacrifice names the offered piece', () => {
    const c = ctx(KNIGHT_E3, 'e3c4', 'brilliant', ev(KNIGHT_E3, line(30, 'e3c4')), [line(30, 'd5c4', 'e1d2')]);
    expect(motif(c)).toMatchObject({ motif: 'sacrifice', piece: 'n', square: 'c4' });
  });
  it('great is only-move, book and forced pass through', () => {
    const c = ctx(KNIGHT_E3, 'e1d1', 'great', ev(KNIGHT_E3, line(30, 'e1d1')), [line(30, 'e8d7')]);
    expect(motif(c).motif).toBe('only-move');
    expect(motif({ ...c, class: 'book' }).motif).toBe('book');
    expect(motif({ ...c, class: 'forced' }).motif).toBe('forced');
  });
  it('checkmate', () => {
    const c = ctx(BACK_RANK, 'a1a8', 'best', ev(BACK_RANK, line({ mate: 1 }, 'a1a8')), []);
    expect(motif(c).motif).toBe('checkmate');
  });
  it('wins-free-piece for a best capture of an unprotected piece that survives the reply', () => {
    const c = ctx(ROOK_FREE, 'f1c4', 'best', ev(ROOK_FREE, line(500, 'f1c4', 'e8d7')), [line(500, 'e8d7', 'e1d1')]);
    expect(motif(c)).toMatchObject({ motif: 'wins-free-piece', piece: 'r', square: 'c4', material: 5 });
  });
  it('is not wins-free-piece when it only takes back on the square the opponent just captured on', () => {
    const c = ctx(ROOK_FREE, 'f1c4', 'best', ev(ROOK_FREE, line(500, 'f1c4', 'e8d7')), [line(500, 'e8d7', 'e1d1')]);
    expect(motif({ ...c, lastCapture: 'c4' }).motif).toBe('none');
    expect(motif({ ...c, lastCapture: 'd5' }).motif).toBe('wins-free-piece');
  });
  it('is not wins-free-piece when part of the piece is given back (rook for bishop)', () => {
    const fen = '4k3/8/8/1p6/2r5/8/8/4KB2 w - - 0 1';
    const c = ctx(fen, 'f1c4', 'best', ev(fen, line(200, 'f1c4', 'b5c4')), [line(200, 'b5c4', 'e1d1')]);
    expect(motif(c).motif).toBe('none');
  });
  it('the report knows a recapture: 5.Qxf3 in the Opera game is not a free bishop', () => {
    const moves = 'e2e4 e7e5 g1f3 d7d6 d2d4 c8g4 d4e5 g4f3 d1f3'.split(' ');
    const c = new Chess();
    const sans = moves.map((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4) }).san);
    const b = new Chess();
    const evals = [ev(b.fen(), line(20, moves[0]))];
    moves.forEach((u, i) => {
      b.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
      evals.push(ev(b.fen(), line(40, ...(moves[i + 1] ? [moves[i + 1]] : ['d6e5', 'f1c4']))));
    });
    expect(sans[8]).toBe('Qxf3');
    const report = buildReport({ startFen: new Chess().fen(), sans, ucis: moves, fens: evals.map((e) => e.fen), evals, openings: null });
    expect(report.moves[8].insight?.motif).not.toBe('wins-free-piece');
  });
  it('is not wins-free-piece when the victim is defended', () => {
    const fen = '4k3/8/8/1p6/2n5/8/8/4KB2 w - - 0 1';
    const c = ctx(fen, 'f1c4', 'best', ev(fen, line(0, 'f1c4', 'b5c4')), [line(-300, 'b5c4', 'e1d1')]);
    expect(motif(c).motif).toBe('none');
  });
});

describe('best reasons', () => {
  const idle = (fen: string, uci: string, bestLine: EngineLine) => ctx(fen, uci, 'inaccuracy', ev(fen, bestLine), [line(0, 'e8e7')]);
  it('castles', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1';
    expect(motif(idle(fen, 'a1b1', line(0, 'e1g1'))).best).toEqual({ reason: 'castles' });
  });
  it('develops a minor piece in the opening', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(motif(idle(fen, 'a2a3', line(30, 'g1f3'))).best).toEqual({ reason: 'develops', piece: 'n', square: 'f3' });
  });
  it('trades when ahead', () => {
    const fen = '3qk3/8/8/8/8/8/8/R2QK3 w - - 0 1';
    expect(motif(idle(fen, 'a1a2', line(500, 'd1d8', 'e8d8'))).best).toEqual({ reason: 'trades-when-ahead' });
  });
  it('keeps-advantage vs holds', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    expect(motif(idle(fen, 'e1d1', line(300, 'e2e4'))).best?.reason).toBe('keeps-advantage');
    expect(motif(idle(fen, 'e1d1', line(-100, 'e2e4'))).best?.reason).toBe('holds');
  });
});

describe('through buildReport', () => {
  it('attaches insights to the moves of a short game', () => {
    const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
    const c = new Chess();
    const fens = [c.fen()];
    const ucis: string[] = [];
    for (const s of sans) {
      const m = c.move(s);
      ucis.push(m.from + m.to + (m.promotion ?? ''));
      fens.push(c.fen());
    }
    const sc = (cp: number): EvalScore => ({ cp });
    const evals: PositionEval[] = [
      ev(fens[0], line(30, 'e2e4'), line(28, 'd2d4')),
      ev(fens[1], line(30, 'e7e5'), line(35, 'c7c5')),
      ev(fens[2], line(30, 'g1f3'), line(25, 'b1c3')),
      ev(fens[3], line(-20, 'b8c6'), line(0, 'g8f6')),
      ev(fens[4], line(-20, 'f1c4'), line(-40, 'g1f3')),
      ev(fens[5], line(-30, 'g7g6', 'h5f3', 'g8f6', 'g1e2'), line(-10, 'd8e7')),
      ev(fens[6], line({ mate: 1 }, 'h5f7'), { score: sc(300), pv: ['h5e5'] }),
      { fen: fens[7], depth: 0, source: 'terminal', lines: [], score: { mate: 1 }, terminal: 'checkmate' },
    ];
    const report = buildReport({ startFen: fens[0], sans, ucis, fens, evals, openings: null });
    expect(report.moves[5].class).toBe('blunder');
    expect(report.moves[5].insight).toMatchObject({ motif: 'allows-mate', mateIn: 1, replySan: 'Qxf7#' });
    // After allowing mate, the best move's point is stopping it, not a side effect of it.
    expect(report.moves[5].insight?.best?.reason).toBe('stops-mate');
    expect(report.moves[6].insight?.motif).toBe('checkmate');
    expect(report.version).toBe(5);
    expect(report.advanced.endgame).toEqual({ white: null, black: null });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
