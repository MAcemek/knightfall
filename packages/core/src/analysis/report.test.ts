import { describe, expect, it } from 'vitest';
import { validateLine } from '../validate.ts';
import { extractClocks, parseClock, parsePgnGame, parsePgnGames, pgnDateToMs, splitPgn } from './pgn.ts';
import { buildReport, epdOf, mistakePuzzles, sideToMove, terminalEval } from './report.ts';
import type { EngineLine, EvalScore, OpeningTable, PositionEval } from './types.ts';

const SCHOLAR = `[Event "Casual game"]
[Site "https://lichess.org/abcdefgh"]
[Date "2026.10.14"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[UTCDate "2026.10.14"]
[UTCTime "18:04:06"]
[WhiteElo "1510"]
[BlackElo "1480"]

1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:03:00] } 2. Qh5 { [%clk 0:02:58] } 2... Nc6 { [%clk 0:02:55.5] } 3. Bc4 { [%clk 0:02:57] } 3... Nf6 { [%clk 0:02:50] } 4. Qxf7# { [%clk 0:02:56] } 1-0`;

describe('pgn', () => {
  it('parses headers, moves, positions and clocks', () => {
    const r = parsePgnGame(SCHOLAR);
    if (!r.ok) throw new Error(r.error);
    const g = r.game;
    expect(g.headers.White).toBe('Alice');
    expect(g.headers.WhiteElo).toBe('1510');
    expect(g.headers.Round).toBeUndefined();
    expect(g.result).toBe('1-0');
    expect(g.sans).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    expect(g.ucis).toEqual(['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']);
    expect(g.fens).toHaveLength(8);
    expect(g.fens[0]).toBe(g.startFen);
    expect(g.clocksMs).toEqual([180000, 180000, 178000, 175500, 177000, 170000, 176000]);
  });
  it('gives null clocks when the PGN has none (or not one per move)', () => {
    const r = parsePgnGame('1. e4 e5 2. Nf3 {[%clk 0:01:00]} Nc6');
    if (!r.ok) throw new Error(r.error);
    expect(r.game.clocksMs).toEqual([null, null, null, null]);
    expect(r.game.result).toBe('*');
  });
  it('starts from a FEN header', () => {
    const r = parsePgnGame('[FEN "4k3/8/8/8/8/8/4P3/4K3 b - - 0 40"]\n[SetUp "1"]\n\n40... Kd7 41. e4 *');
    if (!r.ok) throw new Error(r.error);
    expect(r.game.startFen).toBe('4k3/8/8/8/8/8/4P3/4K3 b - - 0 40');
    expect(r.game.ucis).toEqual(['e8d7', 'e2e4']);
  });
  it('rejects variants, empty games and broken notation', () => {
    expect(parsePgnGame('[Variant "Atomic"]\n\n1. e4 e5 *')).toMatchObject({ ok: false });
    expect(parsePgnGame('[Variant "Standard"]\n\n1. e4 e5 *')).toMatchObject({ ok: true });
    expect(parsePgnGame('[Event "x"]\n\n*')).toMatchObject({ ok: false, error: 'That PGN has no moves.' });
    expect(parsePgnGame('1. e4 e5 2. Zz9')).toMatchObject({ ok: false });
    expect(parsePgnGame('   ')).toMatchObject({ ok: false });
  });
  it('splits and parses several games, reporting the bad ones', () => {
    const second = '[Event "Two"]\n[White "Carol"]\n\n1. d4 d5 1/2-1/2';
    const text = `${SCHOLAR}\n\n${second}\n\n[Event "Broken"]\n\n1. e4 e5 2. Ke3 *\n`;
    expect(splitPgn(text)).toHaveLength(3);
    const { games, errors } = parsePgnGames(text);
    expect(games.map((g) => g.headers.Event)).toEqual(['Casual game', 'Two']);
    expect(games[1].result).toBe('1/2-1/2');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Game 3: /);
  });
  it('handles a single game and empty input', () => {
    expect(parsePgnGames('1. e4 e5').games).toHaveLength(1);
    expect(parsePgnGames('  ')).toEqual({ games: [], errors: ['The PGN is empty.'] });
    expect(parsePgnGames('x'.repeat(2_000_001)).errors[0]).toMatch(/too large/);
  });
  it('parses clock and date helpers', () => {
    expect(parseClock('0:03:00')).toBe(180000);
    expect(parseClock('1:02:03.4')).toBe(3723400);
    expect(parseClock('5:00')).toBe(300000);
    expect(parseClock('soon')).toBeNull();
    expect(extractClocks('1. e4 {[%clk 0:00:59.9]} e5 { [%eval 0.1] [%clk 0:01:00] }')).toEqual([59900, 60000]);
    expect(pgnDateToMs('2026.10.14', '18:04:06')).toBe(Date.UTC(2026, 9, 14, 18, 4, 6));
    expect(pgnDateToMs('2026.10.14')).toBe(Date.UTC(2026, 9, 14));
    expect(pgnDateToMs('????.??.??')).toBeNull();
    expect(pgnDateToMs(undefined)).toBeNull();
  });
});

describe('position helpers', () => {
  it('epdOf and sideToMove', () => {
    expect(epdOf('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
    expect(sideToMove('8/8/8/8/8/8/8/K1k5 b - - 0 1')).toBe('b');
    expect(sideToMove('8/8/8/8/8/8/8/K1k5 w - - 0 1')).toBe('w');
  });
  it('terminalEval scores finished positions without an engine', () => {
    const mated = terminalEval('r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4');
    expect(mated).toMatchObject({ terminal: 'checkmate', score: { mate: 1 }, lines: [], source: 'terminal' });
    expect(terminalEval('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toMatchObject({ terminal: 'stalemate', score: { cp: 0 } });
    expect(terminalEval('8/8/8/8/8/8/8/K1k5 w - - 0 1')).toMatchObject({ terminal: 'draw' });
    expect(terminalEval('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeNull();
    expect(terminalEval('garbage')).toBeNull();
  });
});

/** Scholar's mate with hand-made evaluations (White-POV). */
function scholar() {
  const r = parsePgnGame(SCHOLAR);
  if (!r.ok) throw new Error(r.error);
  const g = r.game;
  const l = (score: EvalScore, ...pv: string[]): EngineLine => ({ score, pv });
  const e = (i: number, score: EvalScore, lines: EngineLine[]): PositionEval => ({ fen: g.fens[i], depth: 16, source: 'engine', lines, score });
  const evals: PositionEval[] = [
    e(0, { cp: 30 }, [l({ cp: 30 }, 'e2e4'), l({ cp: 28 }, 'd2d4')]),
    e(1, { cp: 30 }, [l({ cp: 30 }, 'e7e5'), l({ cp: 35 }, 'c7c5')]),
    e(2, { cp: 30 }, [l({ cp: 30 }, 'g1f3'), l({ cp: 25 }, 'b1c3')]),
    e(3, { cp: -20 }, [l({ cp: -20 }, 'b8c6'), l({ cp: 0 }, 'g8f6')]),
    e(4, { cp: -20 }, [l({ cp: -20 }, 'f1c4'), l({ cp: -40 }, 'g1f3')]),
    e(5, { cp: -30 }, [l({ cp: -30 }, 'g7g6', 'h5f3', 'g8f6', 'g1e2'), l({ cp: -10 }, 'd8e7')]),
    e(6, { mate: 1 }, [l({ mate: 1 }, 'h5f7'), l({ cp: 300 }, 'h5e5')]),
    terminalEval(g.fens[7])!,
  ];
  const openings: OpeningTable = {
    [epdOf(g.fens[1])]: ['B00', "King's Pawn"],
    [epdOf(g.fens[2])]: ['C20', "King's Pawn Game"],
  };
  return { g, evals, openings };
}

describe('buildReport', () => {
  const { g, evals, openings } = scholar();
  const report = buildReport({ startFen: g.startFen, sans: g.sans, ucis: g.ucis, fens: g.fens, evals, openings });

  it('classifies every move', () => {
    expect(report.moves.map((m) => m.class)).toEqual(['book', 'book', 'good', 'best', 'best', 'blunder', 'great']);
  });
  it('fills move metadata', () => {
    const nf6 = report.moves[5];
    expect(nf6).toMatchObject({ ply: 5, color: 'b', moveNumber: 3, san: 'Nf6', uci: 'g8f6', best: { uci: 'g7g6', san: 'g6' }, phase: 'opening' });
    expect(nf6.winBefore).toBeGreaterThan(50);
    expect(nf6.winAfter).toBe(0);
    expect(nf6.accuracy).toBeLessThan(15);
    expect(nf6.cpLoss).toBe(1030);
    expect(report.moves[6]).toMatchObject({ color: 'w', moveNumber: 4, winAfter: 100, accuracy: 100, cpLoss: 0 });
    expect(report.moves[0].moveNumber).toBe(1);
    expect(report.moves[1].moveNumber).toBe(1);
  });
  it('reports the opening from the deepest table hit', () => {
    expect(report.opening).toEqual({ eco: 'C20', name: "King's Pawn Game", ply: 2 });
  });
  it('computes accuracy, ACPL, rating estimate and counts per side', () => {
    expect(report.accuracy.white!).toBeGreaterThan(report.accuracy.black!);
    expect(report.accuracy.white!).toBeGreaterThan(85);
    expect(report.acpl.white).toBeCloseTo(60 / 4, 6);
    expect(report.acpl.black).toBeCloseTo(1030 / 3, 6);
    expect(report.estimatedRating.white!).toBeGreaterThan(report.estimatedRating.black!);
    expect(report.counts.white).toMatchObject({ book: 1, good: 1, best: 1, great: 1, blunder: 0 });
    expect(report.counts.black).toMatchObject({ book: 1, best: 1, blunder: 1 });
    expect(Object.values(report.counts.white).reduce((a, b) => a + b, 0)).toBe(4);
  });
  it('gives phase accuracies only where there are moves', () => {
    expect(report.phases.opening.white).not.toBeNull();
    expect(report.phases.middlegame).toEqual({ white: null, black: null });
    expect(report.phases.endgame).toEqual({ white: null, black: null });
  });
  it('finds the key moment', () => {
    expect(report.keyMoments).toEqual([5]);
  });
  it('works without an opening table and rejects mismatched input', () => {
    const noBook = buildReport({ startFen: g.startFen, sans: g.sans, ucis: g.ucis, fens: g.fens, evals, openings: null });
    expect(noBook.opening).toBeNull();
    expect(noBook.moves[0].class).toBe('best');
    expect(() => buildReport({ startFen: g.startFen, sans: g.sans, ucis: g.ucis, fens: g.fens, evals: evals.slice(1), openings: null })).toThrow();
  });
  it('survives a JSON round trip (it is stored in IndexedDB)', () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe('mistakePuzzles', () => {
  const { g, evals, openings } = scholar();
  const report = buildReport({ startFen: g.startFen, sans: g.sans, ucis: g.ucis, fens: g.fens, evals, openings });

  it('turns the blunder into a puzzle that starts with the opponent\'s move', () => {
    const puzzles = mistakePuzzles(report, { gameKey: 'li-abcdefgh', side: 'b', rating: 1480.4, label: 'vs Alice' });
    expect(puzzles).toHaveLength(1);
    const p = puzzles[0];
    expect(p).toMatchObject({
      id: 'game-li-abcdefgh-5',
      fen: g.fens[4],
      moves: ['f1c4', 'g7g6', 'h5f3', 'g8f6'],
      opponentFirst: true,
      rating: 1480,
      themes: ['from-game', 'blunder'],
      source: 'custom',
      title: 'Your game vs Alice · move 3',
    });
    expect(validateLine(p.fen, p.moves)).toBeNull();
    // Solver moves: an odd number after the setup move.
    expect((p.moves.length - 1) % 2).toBe(1);
  });
  it('only uses the requested side and skips inaccuracies', () => {
    expect(mistakePuzzles(report, { gameKey: 'k', side: 'w', rating: 1500, label: 'vs Bob' })).toEqual([]);
  });
});
