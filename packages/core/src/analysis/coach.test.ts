import { describe, expect, it } from 'vitest';
import { accuracyGrade, CLASS_PHRASE, coachBestText, coachExplainText, coachMoveText, coachSummary, judgeRetry, decisiveMoment, materialBalance, moveSentence, showsBestMove } from './coach.ts';
import { MOVE_CLASSES, type AnalysedMove, type EvalScore, type GamePhase, type GameReport, type MoveClass, type PositionEval, type Side } from './types.ts';
import type { MoveInsight } from './insight.ts';

type BestInsight = NonNullable<MoveInsight['best']>;

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
    expect(coachSummary(win('piece'), { perspective: 'w' })).toBe('You won a piece in the middlegame and never let go.');
    expect(coachSummary(win('piece', 'endgame'), { perspective: null })).toBe('White won a piece in the endgame and never let go.');
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
    expect(coachSummary(fake([0, 10, 0], { accuracy: 93 }), { perspective: 'w' })).toBe('Sharp, accurate play from start to finish.');
    expect(coachSummary(fake([0, 10, 0], { accuracy: 93 }), { perspective: null })).toBe("A game with chances for both sides. Let's look at the key moments.");
    expect(coachSummary(fake([0, 10, 0], { accuracy: 80 }), { perspective: 'w' })).toBe("A game with chances for both sides. Let's look at the key moments.");
  });
});

describe('per-move coach text', () => {
  const mv = (ply: number, color: Side = 'w', uci = 'a2a3') => ({ ply, color, uci, best: { san: 'Nd2' } });
  const hang: MoveInsight = { motif: 'hangs-piece', piece: 'n', square: 'f3', material: 3, replySan: 'exf3' };

  it('hangs-piece in each perspective, left behind vs moved onto', () => {
    expect(coachMoveText(mv(0), hang, 'w')).toBe('That leaves your knight on f3 hanging. They can just take it.');
    expect(coachMoveText(mv(0), hang, 'b')).toBe('That leaves their knight on f3 hanging. You can just take it.');
    expect(coachMoveText(mv(0), hang, null)).toBe("That leaves White's knight on f3 hanging. Black can just take it.");
    expect(coachMoveText(mv(0, 'w', 'd2f3'), hang, 'w')).toBe('That puts your knight on f3 where it can just be captured.');
    expect(coachExplainText(mv(0), hang, 'w')).toBe('After exf3 you are a knight down.');
    expect(coachExplainText(mv(1), hang, null)).toBe('Black plays exf3 and White ends up a knight down.');
    expect(coachExplainText(mv(0), { ...hang, material: 2 }, 'w')).toBe('After exf3 you are 2 points of material down.');
  });

  it('says the reply is checkmate when the mate is in one, and only forces the mate when it is further away', () => {
    const one: MoveInsight = { motif: 'allows-mate', mateIn: 1, replySan: 'Ra8#' };
    for (let ply = 0; ply < 6; ply++) {
      const t = coachExplainText(mv(ply), one, 'w');
      expect(t).toContain('checkmate');
      expect(t).not.toMatch(/next move|cannot be stopped|forced/);
    }
    expect(coachExplainText(mv(0), { motif: 'allows-mate', mateIn: 2, replySan: 'Qh7+' }, 'w')).toMatch(/forced|cannot be stopped|follows/);
  });
  it('does not call a position balanced, a small lead or a slight slip when the eval is not known to be', () => {
    for (let ply = 0; ply < 6; ply++) {
      expect(coachExplainText(mv(ply), { motif: 'lets-off-hook' }, 'w')).not.toMatch(/balanced/);
      expect(coachExplainText(mv(ply), { motif: 'throws-win' }, 'w')).not.toMatch(/slightly|lead is small/);
      expect(coachMoveText(mv(ply), { motif: 'drifts' }, 'w')).not.toMatch(/a little/);
      expect(coachMoveText(mv(ply), { motif: 'only-move' }, 'w')).not.toMatch(/advantage|edge/);
    }
  });

  const motifs: MoveInsight[] = [
    { motif: 'allows-mate', mateIn: 2, replySan: 'Qh7+' },
    { motif: 'allows-mate', mateIn: 1 },
    { motif: 'misses-mate', mateIn: 3 },
    hang,
    { motif: 'misses-free-piece', piece: 'r', square: 'c4', material: 5 },
    { motif: 'loses-material', material: 3, replySan: 'e4' },
    { motif: 'misses-material', material: 2 },
    { motif: 'walks-into-fork', piece: 'n', square: 'c2', material: 5, replySan: 'Nc2+' },
    { motif: 'lets-off-hook' },
    { motif: 'throws-win' },
    { motif: 'drifts' },
    { motif: 'sacrifice', piece: 'b', square: 'e6' },
    { motif: 'only-move' },
    { motif: 'checkmate' },
    { motif: 'wins-free-piece', piece: 'q', square: 'd5', material: 9 },
    { motif: 'book' },
    { motif: 'forced' },
  ];
  it('says something sensible for every motif, every phrasing, every perspective', () => {
    for (const ins of motifs) {
      for (const persp of ['w', 'b', null] as (Side | null)[]) {
        for (let ply = 0; ply < 6; ply++) {
          for (const fn of [coachMoveText, coachExplainText]) {
            const t = fn(mv(ply), ins, persp);
            expect(t, `${ins.motif} ${persp} ${ply}`).not.toBe('');
            expect(t).not.toMatch(/undefined|NaN|null|\[object/);
            if (persp === null) expect(t).not.toMatch(/\b(you|your|they|their)\b/i);
          }
        }
      }
    }
  });
  it('uses you/they or White/Black by perspective', () => {
    const miss: MoveInsight = { motif: 'misses-free-piece', piece: 'r', square: 'c4', material: 5 };
    expect(coachMoveText(mv(0), miss, 'w')).toBe('You could have won a free rook on c4.');
    expect(coachMoveText(mv(0), miss, 'b')).toBe('They could have won a free rook on c4.');
    expect(coachMoveText(mv(0), miss, null)).toBe('White could have won a free rook on c4.');
    expect(coachMoveText(mv(0, 'b'), miss, null)).toBe('Black could have won a free rook on c4.');
    expect(coachMoveText(mv(0), { motif: 'allows-mate', mateIn: 1 }, 'w')).toBe('That lets them force checkmate next move.');
  });
  it('rotates phrasings by ply, never repeating a sentence on the next move', () => {
    for (const ins of motifs) {
      for (const fn of [coachMoveText, coachExplainText]) {
        for (let ply = 0; ply < 8; ply++) {
          const a = fn(mv(ply), ins, 'w');
          const b = fn(mv(ply + 1), ins, 'w');
          expect(a, ins.motif + ' ' + ply).not.toBe(b);
        }
      }
    }
  });
  it('names the piece and the square where the insight has them', () => {
    const named: MoveInsight[] = [
      hang,
      { motif: 'misses-free-piece', piece: 'r', square: 'c4', material: 5 },
      { motif: 'walks-into-fork', piece: 'n', square: 'c2', material: 5, replySan: 'Nc2+' },
      { motif: 'sacrifice', piece: 'b', square: 'e6' },
      { motif: 'wins-free-piece', piece: 'q', square: 'd5', material: 9 },
    ];
    for (const ins of named) {
      const piece = { n: 'knight', r: 'rook', b: 'bishop', q: 'queen' }[ins.piece as 'n'];
      for (let ply = 0; ply < 6; ply++) {
        const t = coachMoveText(mv(ply), ins, 'w');
        expect(t, ).toContain(piece);
        expect(t, ).toContain(ins.square!);
      }
    }
  });
  it('names the mate length, the material and the reply', () => {
    for (let ply = 0; ply < 4; ply++) {
      expect(coachMoveText(mv(ply), { motif: 'allows-mate', mateIn: 2 }, 'w')).toContain('checkmate in 2');
      expect(coachMoveText(mv(ply), { motif: 'loses-material', material: 3 }, 'w')).toMatch(/3 points/);
    }
    for (let ply = 0; ply < 3; ply++) expect(coachExplainText(mv(ply), { motif: 'allows-mate', mateIn: 2, replySan: 'Qh7+' }, 'w')).toContain('Qh7+');
  });
  it('says what the better move does when a quiet move drifts', () => {
    const ins: MoveInsight = { motif: 'drifts', best: { reason: 'develops', piece: 'n' } };
    const texts = [0, 1, 2].map((ply) => coachMoveText(mv(ply), ins, 'w'));
    expect(texts.join(' ')).toMatch(/Better was Nd2, which (brings the knight into the game|develops the knight|gets the knight off its starting square)./);
    // Without a verified reason there is no such sentence.
    expect([0, 1, 2, 3].map((ply) => coachMoveText(mv(ply), { motif: 'drifts' }, 'w')).join(' ')).not.toContain('Better was');
  });
  it('names the capture when the reply takes the hanging piece', () => {
    const ins: MoveInsight = { ...hang, threat: { from: 'e4', to: 'f3' } };
    expect(coachExplainText(mv(0), ins, 'w')).toBe('They play exf3, taking the knight on f3, and you are a knight down.');
    expect(coachExplainText(mv(0), { ...hang, threat: { from: 'e4', to: 'd3' } }, 'w')).toBe('After exf3 you are a knight down.');
  });
  it('explains a miss with the better move', () => {
    const ins: MoveInsight = { motif: 'misses-free-piece', piece: 'r', square: 'c4', material: 5, best: { reason: 'wins-piece', piece: 'r', square: 'c4' } };
    const texts = [0, 1, 2].map((ply) => coachExplainText(mv(ply), ins, 'w'));
    expect(texts).toContain('Nd2 would have won the rook on c4.');
  });
  it('is empty when there is nothing to add', () => {
    expect(coachMoveText(mv(0), { motif: 'none' }, 'w')).toBe('');
    expect(coachMoveText(mv(0), undefined, 'w')).toBe('');
    expect(coachExplainText(mv(0), undefined, 'w')).toBe('');
    expect(coachBestText(mv(0), { motif: 'drifts' }, 'w')).toBe('');
    expect(coachBestText({ ply: 0, color: 'w', uci: 'a2a3' }, { motif: 'drifts', best: { reason: 'holds' } }, 'w')).toBe('');
  });
  it('coachBestText names the move for each reason', () => {
    const reasons: BestInsight[] = [
      { reason: 'mates', mateIn: 1 }, { reason: 'mates', mateIn: 3 },
      { reason: 'wins-piece', piece: 'r', square: 'c4' }, { reason: 'wins-material', material: 2 },
      { reason: 'saves-piece', piece: 'n' }, { reason: 'defends', piece: 'b', square: 'c1' },
      { reason: 'castles' }, { reason: 'develops', piece: 'n' }, { reason: 'trades-when-ahead' },
      { reason: 'keeps-advantage' }, { reason: 'holds' },
    ];
    for (const best of reasons) {
      const named = best.piece ? { n: 'knight', r: 'rook', b: 'bishop' }[best.piece as 'n'] : null;
      for (let ply = 0; ply < 4; ply++) {
        const t = coachBestText(mv(ply), { motif: 'drifts', best }, 'w');
        if (named && best.reason !== 'trades-when-ahead') expect(t, best.reason).toContain(named);
        if (best.square) expect(t, best.reason).toContain(best.square);
        if (best.reason === 'mates' && best.mateIn === 3) expect(t).toContain('checkmate in 3');
        // Neighbouring moves do not repeat the sentence.
        expect(coachBestText(mv(ply), { motif: 'drifts', best }, 'w')).not.toBe(coachBestText(mv(ply + 1), { motif: 'drifts', best }, 'w'));
      }
      for (const persp of ['w', 'b', null] as (Side | null)[]) {
        for (let ply = 0; ply < 3; ply++) {
          const t = coachBestText(mv(ply), { motif: 'drifts', best }, persp);
          expect(t).toMatch(/^Nd2 /);
          expect(t).not.toMatch(/undefined|NaN/);
        }
      }
    }
    expect(coachBestText(mv(0), { motif: 'drifts', best: { reason: 'saves-piece', piece: 'n' } }, 'w')).toBe('Nd2 moves the knight out of danger.');
  });
});

describe('judgeRetry', () => {
  const l = (cp: number, ...pv: string[]) => ({ score: { cp }, pv });
  const evalOf = (...lines: ReturnType<typeof l>[]): PositionEval => ({ fen: START, depth: 14, source: 'engine', lines, score: lines[0].score });
  it('best / good / wrong, from either side', () => {
    const w = evalOf(l(100, 'e2e4'), l(80, 'd2d4'), l(-200, 'a2a3'));
    expect(judgeRetry(w, 'e2e4', 'w')).toBe('best');
    expect(judgeRetry(w, 'd2d4', 'w')).toBe('good');
    expect(judgeRetry(w, 'a2a3', 'w')).toBe('wrong');
    expect(judgeRetry(w, 'h2h3', 'w')).toBe('wrong');
    const b = evalOf(l(-100, 'e7e5'), l(50, 'd7d5'));
    expect(judgeRetry(b, 'e7e5', 'b')).toBe('best');
    expect(judgeRetry(b, 'd7d5', 'b')).toBe('wrong');
    expect(judgeRetry(evalOf(l(-100, 'e7e5'), l(-120, 'd7d5')), 'd7d5', 'b')).toBe('good');
    expect(judgeRetry({ ...w, lines: [] }, 'e2e4', 'w')).toBe('wrong');
  });
});
