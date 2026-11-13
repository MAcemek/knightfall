import { describe, expect, it } from 'vitest';
import { accuracyGrade, CLASS_PHRASE, coachSummary, decisiveMoment, materialBalance, moveSentence, showsBestMove } from './coach.ts';
import { MOVE_CLASSES, type AnalysedMove, type EvalScore, type GamePhase, type GameReport, type MoveClass } from './types.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NO_BLACK_QUEEN = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NO_WHITE_QUEEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1';
const NO_BLACK_PAWN = 'rnbqkbnr/ppppppp1/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('CLASS_PHRASE / showsBestMove / moveSentence', () => {
  it('has a phrase for every class', () => {
    for (const c of MOVE_CLASSES) expect(CLASS_PHRASE[c]).toMatch(/^is /);
    expect(CLASS_PHRASE.best).toBe('is best');
    expect(CLASS_PHRASE.great).toBe('is a great move');
    expect(CLASS_PHRASE.blunder).toBe('is a blunder');
    expect(moveSentence('Nxe5', 'brilliant')).toBe('Nxe5 is brilliant');
  });
  it('shows the engine move only after weaker classes', () => {
    for (const c of ['brilliant', 'great', 'best', 'book', 'forced'] as MoveClass[]) expect(showsBestMove(c)).toBe(false);
    for (const c of ['excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'] as MoveClass[]) expect(showsBestMove(c)).toBe(true);
  });
});

describe('accuracyGrade', () => {
  it('maps a mean accuracy to a class icon, with null for none', () => {
    expect(accuracyGrade(null)).toBeNull();
    const cases: [number, MoveClass][] = [
      [100, 'best'], [95, 'best'], [94.9, 'excellent'], [85, 'excellent'], [84.9, 'good'], [70, 'good'],
      [69.9, 'inaccuracy'], [55, 'inaccuracy'], [54.9, 'mistake'], [40, 'mistake'], [39.9, 'blunder'], [0, 'blunder'],
    ];
    for (const [acc, cls] of cases) expect(accuracyGrade(acc)).toBe(cls);
  });
});

describe('materialBalance', () => {
  it('is White minus Black, pawns included', () => {
    expect(materialBalance(START)).toBe(0);
    expect(materialBalance(NO_BLACK_QUEEN)).toBe(9);
    expect(materialBalance(NO_WHITE_QUEEN)).toBe(-9);
    expect(materialBalance(NO_BLACK_PAWN)).toBe(1);
    expect(materialBalance('4k3/8/8/8/8/8/8/R2QKB1N w - - 0 1')).toBe(5 + 9 + 3 + 3);
  });
});

/** A report with just what the coach reads. `cps` are White-POV scores for every position. */
function fake(
  cps: (number | { mate: number })[],
  opts: { fens?: string[]; classes?: MoveClass[]; phases?: GamePhase[]; accuracy?: number } = {},
): GameReport {
  const n = cps.length - 1;
  const fens = opts.fens ?? Array.from({ length: n + 1 }, () => START);
  const moves = Array.from({ length: n }, (_, i) => ({
    ply: i,
    fenBefore: fens[i],
    fenAfter: fens[i + 1],
    class: opts.classes?.[i] ?? 'best',
    phase: opts.phases?.[i] ?? 'middlegame',
  })) as unknown as AnalysedMove[];
  const score = (c: number | { mate: number }): EvalScore => (typeof c === 'number' ? { cp: c } : c);
  const acc = opts.accuracy ?? 80;
  return {
    moves,
    evals: cps.map((c) => ({ fen: START, depth: 1, source: 'engine', lines: [], score: score(c) })),
    accuracy: { white: acc, black: acc },
  } as unknown as GameReport;
}

describe('decisiveMoment', () => {
  it('finds the first move after which one side stayed clearly ahead to the end', () => {
    const fens = [START, START, START, NO_BLACK_QUEEN, NO_BLACK_QUEEN];
    const r = fake([0, 0, 500, 500, 600], { fens });
    // Expected points: .5 .5 .852 .852 .891 -> the winning stretch starts at position 2, reached by move (ply) 1.
    expect(decisiveMoment(r)).toEqual({ ply: 1, winner: 'w', material: 9 });
  });
  it('works for Black and counts material from the winner view', () => {
    const fens = [START, START, NO_WHITE_QUEEN, NO_WHITE_QUEEN];
    expect(decisiveMoment(fake([0, -50, -700, -900], { fens }))).toEqual({ ply: 1, winner: 'b', material: 9 });
  });
  it('is null for an unclear ending, no moves, or a lead that was lost again', () => {
    expect(decisiveMoment(fake([0, 50, 100]))).toBeNull();
    expect(decisiveMoment(fake([0]))).toBeNull();
    expect(decisiveMoment(fake([600, 600, 0]))).toBeNull();
  });
  it('treats mate scores as decisive', () => {
    expect(decisiveMoment(fake([0, { mate: 3 }, { mate: 1 }, { mate: 0 }]))).toMatchObject({ winner: 'w' });
  });
});

describe('coachSummary', () => {
  const win = (material: 'piece' | 'pawn' | 'none', phase: GamePhase = 'middlegame') => {
    const after = material === 'none' ? START : material === 'pawn' ? NO_BLACK_PAWN : NO_BLACK_QUEEN;
    return fake([0, 600, 700], { fens: [START, after, after], phases: [phase, phase] });
  };
  it('a win with material gained', () => {
    expect(coachSummary(win('piece'), { perspective: 'w' })).toBe('You won a piece in the middlegame and never let go!');
    expect(coachSummary(win('piece', 'endgame'), { perspective: null })).toBe('White won a piece in the endgame and never let go!');
    expect(coachSummary(win('pawn'), { perspective: 'w' })).toBe('You picked up material in the middlegame and kept control to the end.');
    expect(coachSummary(win('none', 'opening'), { perspective: 'w' })).toBe('You took charge in the opening and never looked back.');
  });
  it('a loss: one slip, or the opponent simply took over', () => {
    const slip = fake([0, 600, 700], { classes: ['blunder', 'best'], phases: ['middlegame', 'middlegame'] });
    expect(coachSummary(slip, { perspective: 'b' })).toBe("One slip in the middlegame decided this game. Let's find where it turned.");
    const quiet = fake([0, 600, 700], { classes: ['best', 'best'], phases: ['endgame', 'endgame'] });
    expect(coachSummary(quiet, { perspective: 'b' })).toBe("Your opponent took over in the endgame. Let's see how they did it.");
  });
  it('a draw, a sharp game, and the default', () => {
    expect(coachSummary(fake([0, 10, 0]), { perspective: 'w', result: '1/2-1/2' })).toBe('A hard-fought draw. Both sides held their ground.');
    expect(coachSummary(fake([0, 10, 0], { accuracy: 93 }), { perspective: 'w' })).toBe('Sharp, accurate play from start to finish!');
    expect(coachSummary(fake([0, 10, 0], { accuracy: 93 }), { perspective: null })).toBe("A game with chances for both sides. Let's look at the key moments.");
    expect(coachSummary(fake([0, 10, 0], { accuracy: 80 }), { perspective: 'w' })).toBe("A game with chances for both sides. Let's look at the key moments.");
  });
});
