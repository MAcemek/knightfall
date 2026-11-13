import { describe, expect, it } from 'vitest';
import { classByDrop, classifyMove, type ClassifyContext } from './classify.ts';
import { isSacrifice, pieceMaterial } from './sacrifice.ts';
import type { EngineLine, EvalScore, PositionEval } from './types.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** White knight f3 can jump to g5 where the f6 pawn takes it for nothing. */
const KNIGHT_HANG = '4k3/8/5p2/8/8/5N2/8/4K3 w - - 0 1';

const line = (score: EvalScore, first: string): EngineLine => ({ score, pv: [first] });
const ev = (score: EvalScore, lines: EngineLine[] = []): PositionEval => ({ fen: '', depth: 16, source: 'engine', lines, score });

/** A White move from the start position: e2e4 played, engine prefers `best` (cp 30) then d2d4 (cp 25). */
function ctx(over: Partial<ClassifyContext> & { afterCp?: number; best?: string } = {}): ClassifyContext {
  const { afterCp = 30, best = 'e2e4', ...rest } = over;
  return {
    fenBefore: START,
    uci: 'e2e4',
    mover: 'w',
    before: ev({ cp: 30 }, [line({ cp: 30 }, best), line({ cp: 25 }, 'd2d4')]),
    after: ev({ cp: afterCp }),
    isBook: false,
    legalMoves: 20,
    ...rest,
  };
}

describe('classByDrop', () => {
  it('uses the thresholds 2 / 5 / 10 / 20', () => {
    expect(classByDrop(0)).toBe('excellent');
    expect(classByDrop(2)).toBe('excellent');
    expect(classByDrop(2.01)).toBe('good');
    expect(classByDrop(5)).toBe('good');
    expect(classByDrop(5.01)).toBe('inaccuracy');
    expect(classByDrop(10)).toBe('inaccuracy');
    expect(classByDrop(10.01)).toBe('mistake');
    expect(classByDrop(20)).toBe('mistake');
    expect(classByDrop(20.01)).toBe('blunder');
  });
});

describe('classifyMove', () => {
  it('book beats everything', () => {
    expect(classifyMove(ctx({ isBook: true, afterCp: -900 }))).toBe('book');
  });
  it('forced when there was only one legal move', () => {
    expect(classifyMove(ctx({ legalMoves: 1, afterCp: -900 }))).toBe('forced');
  });
  it('best when it is the engine\'s first choice and the alternatives are close', () => {
    expect(classifyMove(ctx())).toBe('best');
  });
  it('great when it is the only move that holds (second line worse by more than 10 win%)', () => {
    const before = ev({ cp: 30 }, [line({ cp: 30 }, 'e2e4'), line({ cp: -200 }, 'd2d4')]);
    expect(classifyMove(ctx({ before }))).toBe('great');
    const close = ev({ cp: 30 }, [line({ cp: 30 }, 'e2e4'), line({ cp: -60 }, 'd2d4')]);
    expect(classifyMove(ctx({ before: close }))).toBe('best');
  });
  it('best (not great) when the engine gave a single line', () => {
    expect(classifyMove(ctx({ before: ev({ cp: 30 }, [line({ cp: 30 }, 'e2e4')]) }))).toBe('best');
  });
  it('grades other moves by the win-chance drop', () => {
    expect(classifyMove(ctx({ best: 'g1f3', afterCp: 25 }))).toBe('excellent');
    expect(classifyMove(ctx({ best: 'g1f3', afterCp: 0 }))).toBe('good');
    expect(classifyMove(ctx({ best: 'g1f3', afterCp: -50 }))).toBe('inaccuracy');
    expect(classifyMove(ctx({ best: 'g1f3', afterCp: -150 }))).toBe('mistake');
    expect(classifyMove(ctx({ best: 'g1f3', afterCp: -400 }))).toBe('blunder');
  });
  it('an improvement over the engine line still counts as excellent, not best', () => {
    expect(classifyMove(ctx({ best: 'g1f3', afterCp: 80 }))).toBe('excellent');
  });
  it('works from Black\'s side (scores stay White-POV)', () => {
    const black = (afterCp: number) =>
      classifyMove({
        fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        uci: 'a7a6',
        mover: 'b',
        before: ev({ cp: 30 }, [line({ cp: 30 }, 'e7e5'), line({ cp: 35 }, 'c7c5')]),
        after: ev({ cp: afterCp }),
        isBook: false,
        legalMoves: 20,
      });
    expect(black(40)).toBe('excellent');
    expect(black(450)).toBe('blunder');
    expect(black(-300)).toBe('excellent');
  });
  it('miss: a big drop right after the opponent erred, while still not worse', () => {
    const before = ev({ cp: 400 }, [line({ cp: 400 }, 'g1f3'), line({ cp: 100 }, 'd2d4')]);
    expect(classifyMove(ctx({ before, afterCp: 20, previous: 'blunder' }))).toBe('miss');
    expect(classifyMove(ctx({ before, afterCp: 20, previous: 'mistake' }))).toBe('miss');
    // Without a gift from the opponent the same drop is a blunder.
    expect(classifyMove(ctx({ before, afterCp: 20, previous: 'good' }))).toBe('blunder');
    expect(classifyMove(ctx({ before, afterCp: 20 }))).toBe('blunder');
    // Ending up clearly worse is not a "miss".
    expect(classifyMove(ctx({ before, afterCp: -300, previous: 'blunder' }))).toBe('blunder');
  });
  it('brilliant: a sound sacrifice in a position that was not already won', () => {
    const base = { fenBefore: KNIGHT_HANG, uci: 'f3g5', mover: 'w' as const, isBook: false, legalMoves: 12 };
    const before = ev({ cp: 150 }, [line({ cp: 150 }, 'f3g5'), line({ cp: 140 }, 'e1e2')]);
    expect(classifyMove({ ...base, before, after: ev({ cp: 150 }) })).toBe('brilliant');
    // Unsound (drops more than 2): graded normally.
    expect(classifyMove({ ...base, before: ev({ cp: 150 }, [line({ cp: 150 }, 'e1e2')]), after: ev({ cp: -300 }) })).toBe('blunder');
    // Already winning by more than 97%: just "best".
    const won = ev({ mate: 4 }, [line({ mate: 4 }, 'f3g5'), line({ mate: 5 }, 'e1e2')]);
    expect(classifyMove({ ...base, before: won, after: ev({ mate: 3 }) })).toBe('best');
    // A sacrifice that keeps a worse position is not brilliant.
    const worse = ev({ cp: -200 }, [line({ cp: -200 }, 'f3g5'), line({ cp: -210 }, 'e1e2')]);
    expect(classifyMove({ ...base, before: worse, after: ev({ cp: -200 }) })).toBe('best');
  });
});

describe('isSacrifice', () => {
  it('detects a piece left en prise', () => {
    expect(isSacrifice(KNIGHT_HANG, 'f3g5')).toBe(true);
  });
  it('detects a queen taking a defended pawn', () => {
    expect(isSacrifice('4k3/5p2/4p3/8/8/8/4Q3/4K3 w - - 0 1', 'e2e6')).toBe(true);
  });
  it('ignores equal trades, safe moves, pawn moves and king moves', () => {
    expect(isSacrifice('4k3/8/5n2/8/4N3/8/8/4K3 w - - 0 1', 'e4f6')).toBe(false);
    expect(isSacrifice(KNIGHT_HANG, 'f3d4')).toBe(false);
    expect(isSacrifice(START, 'e2e4')).toBe(false);
    expect(isSacrifice(KNIGHT_HANG, 'e1e2')).toBe(false);
  });
  it('a defended piece attacked by an equal piece is not a sacrifice', () => {
    // Rd1-d7 is attacked by the d8 rook but defended by the b5 bishop.
    expect(isSacrifice('3rk3/8/8/1B6/8/8/8/3RK3 w - - 0 1', 'd1d7')).toBe(false);
  });
  it('returns false for illegal input', () => {
    expect(isSacrifice(START, 'e2e5')).toBe(false);
    expect(isSacrifice('not a fen', 'e2e4')).toBe(false);
  });
});

describe('pieceMaterial', () => {
  it('counts pieces of both sides without pawns and kings', () => {
    expect(pieceMaterial(START)).toBe(62);
    expect(pieceMaterial('4k3/pppp4/8/8/8/8/PPPP4/R3K2r w - - 0 1')).toBe(10);
  });
});
