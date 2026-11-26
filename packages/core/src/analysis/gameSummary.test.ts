import { describe, expect, it } from 'vitest';
import { gameSummary, MOTIF_PRACTISE } from './gameSummary.ts';
import type { MoveInsight } from './insight.ts';
import type { GamePhase, GameReport, MoveClass, Side } from './types.ts';

interface Spec {
  cls?: MoveClass;
  epLoss?: number;
  accuracy?: number;
  phase?: GamePhase;
  insight?: MoveInsight;
  san?: string;
  best?: string;
}

/** A report with only what the summary reads: alternating moves, White first. */
function report(specs: Spec[]): GameReport {
  const moves = specs.map((s, ply) => ({
    ply,
    color: (ply % 2 === 0 ? 'w' : 'b') as Side,
    moveNumber: Math.floor(ply / 2) + 1,
    san: s.san ?? 'Nf3',
    uci: 'g1f3',
    class: s.cls ?? 'good',
    phase: s.phase ?? 'middlegame',
    epLoss: s.epLoss ?? 0,
    accuracy: s.accuracy ?? 90,
    winBefore: 60,
    winAfter: 40,
    best: s.best ? { uci: 'b1c3', san: s.best } : undefined,
    insight: s.insight,
  }));
  return { moves } as unknown as GameReport;
}

const quiet = (n: number, extra: Spec = {}): Spec[] => Array.from({ length: n }, () => ({ ...extra }));

describe('gameSummary: what went well', () => {
  it('names a brilliant move with its move number, then a great one', () => {
    const specs = quiet(20);
    specs[6] = { cls: 'brilliant', san: 'Nxe5' };
    specs[11] = { cls: 'great', san: 'Qd7' };
    expect(gameSummary(report(specs), 'w').wentWell[0]).toBe('You played a brilliant move on move 4: Nxe5.');
    // Black's great move is not credited to White.
    expect(gameSummary(report(specs), 'w').wentWell.join(' ')).not.toContain('Qd7');
    expect(gameSummary(report(specs), 'b').wentWell[0]).toBe('You played a great move on move 6: Qd7.');
  });
  it('credits an accurate opening and a game without blunders, at most two facts', () => {
    const specs = quiet(20, { phase: 'opening', accuracy: 92 });
    const s = gameSummary(report(specs), 'w');
    expect(s.wentWell).toEqual(['Your opening was accurate: 92% accuracy.', 'You made no blunders.']);
  });
  it('needs an opening accuracy above 85 and a blunder-free game', () => {
    const specs = quiet(20, { phase: 'opening', accuracy: 85 });
    specs[2] = { cls: 'blunder', phase: 'opening', accuracy: 10, epLoss: 0.4 };
    expect(gameSummary(report(specs), 'w').wentWell).toEqual([]);
  });
  it('talks about White and Black when the side is unknown', () => {
    const specs = quiet(20);
    specs[4] = { cls: 'brilliant', san: 'Bxh7+' };
    specs[7] = { cls: 'great', san: 'Rd8' };
    expect(gameSummary(report(specs), null).wentWell).toEqual(['White played a brilliant move on move 3: Bxh7+.', 'Black played a great move on move 4: Rd8.']);
  });
  it('says nothing about a short game', () => {
    expect(gameSummary(report(quiet(4)), 'w').wentWell).toEqual([]);
  });
});

describe('gameSummary: turning points', () => {
  const specs = (): Spec[] => {
    const s = quiet(12);
    s[2] = { cls: 'mistake', epLoss: 0.2, san: 'Bc4', insight: { motif: 'hangs-piece', piece: 'n', square: 'f3', material: 3 } };
    s[4] = { cls: 'blunder', epLoss: 0.45, san: 'Qh5', insight: { motif: 'allows-mate', mateIn: 2 } };
    s[6] = { cls: 'inaccuracy', epLoss: 0.06, san: 'a3', best: 'Nd2' };
    s[8] = { cls: 'inaccuracy', epLoss: 0.07, san: 'h3' };
    s[5] = { cls: 'blunder', epLoss: 0.5, san: 'Qxb2' };
    return s;
  };
  it('lists the largest losses of the reader, up to three, in game order, each with its ply and move number', () => {
    const tp = gameSummary(report(specs()), 'w').turningPoints;
    expect(tp.map((t) => t.san)).toEqual(['Bc4', 'Qh5', 'h3']);
    expect(tp[1]).toMatchObject({ ply: 4, moveNumber: 3, color: 'w', cls: 'blunder' });
    expect(tp[1].reason).toBe('That lets them force checkmate in 2.');
  });
  it('only lists inaccuracies, mistakes, misses and blunders, whatever the loss', () => {
    const s = quiet(12);
    for (const [ply, cls] of [[0, 'best'], [2, 'great'], [4, 'book'], [6, 'forced'], [8, 'excellent'], [10, 'good']] as const) s[ply] = { cls, epLoss: 0.2 };
    expect(gameSummary(report(s), 'w').turningPoints).toEqual([]);
    s[10] = { cls: 'miss', epLoss: 0.1, san: 'Kg1' };
    expect(gameSummary(report(s), 'w').turningPoints.map((t) => t.san)).toEqual(['Kg1']);
  });
  it('gives each a one-line reason from its insight, or from the engine move, or from the win chance', () => {
    const tp = gameSummary(report(specs()), 'w').turningPoints;
    expect(tp[0].reason).toMatch(/^[^.]*knight[^.]*\.( [^.]*\.)?$/);
    expect(tp[0].reason.split('. ').length).toBeLessThanOrEqual(2);
    const noInsight = report([{}, {}, { cls: 'mistake', epLoss: 0.2, san: 'a3', best: 'Nd2' }]);
    expect(gameSummary(noInsight, 'w').turningPoints[0].reason).toBe('The engine preferred Nd2.');
    const bare = report([{}, {}, { cls: 'mistake', epLoss: 0.2, san: 'a3' }]);
    expect(gameSummary(bare, 'w').turningPoints[0].reason).toBe('Your win chance fell from 60% to 40%.');
    expect(gameSummary(bare, null).turningPoints[0].reason).toBe("White's win chance fell from 60% to 40%.");
  });
  it('covers both sides when the side is unknown, and skips tiny losses', () => {
    const tp = gameSummary(report(specs()), null).turningPoints;
    expect(tp.map((t) => t.san)).toEqual(['Bc4', 'Qh5', 'Qxb2']);
    expect(gameSummary(report(quiet(10, { epLoss: 0.01 })), 'w').turningPoints).toEqual([]);
  });
});

describe('gameSummary: practise this', () => {
  const bad = (motif: MoveInsight['motif'] | null, n: number, phase: GamePhase = 'middlegame'): Spec[] =>
    Array.from({ length: n }, () => ({ cls: 'mistake' as const, epLoss: 0.2, phase, insight: motif ? ({ motif } as MoveInsight) : undefined }));
  /** Alternating specs where only White's moves are the given ones. */
  const whiteOnly = (items: Spec[]): GameReport => report(items.flatMap((s) => [s, {}]));

  it('is nothing without a mistake', () => {
    expect(gameSummary(report(quiet(10)), 'w').practise).toBeNull();
  });
  it('maps the most frequent motif to its Train theme', () => {
    const r = whiteOnly([...bad('walks-into-fork', 2), ...bad('hangs-piece', 1)]);
    expect(gameSummary(r, 'w').practise).toEqual({
      kind: 'theme',
      theme: 'fork',
      href: '/train/theme/fork',
      label: 'Forks',
      reason: 'You walked into a fork 2 times in this game.',
    });
    expect(gameSummary(whiteOnly(bad('misses-mate', 1)), 'w').practise).toMatchObject({ theme: 'mateIn2', reason: 'You missed a forced mate once in this game.' });
    expect(gameSummary(whiteOnly(bad('allows-mate', 1)), 'w').practise).toMatchObject({ theme: 'defensiveMove' });
  });
  it('uses the Blunder check for hanging pieces and missed material', () => {
    for (const m of ['hangs-piece', 'misses-free-piece', 'loses-material', 'misses-material'] as const) {
      expect(gameSummary(whiteOnly(bad(m, 2)), 'w').practise).toMatchObject({ kind: 'blunder-check', href: '/train/blunder-check' });
    }
  });
  it('breaks a tie in favour of the motif listed first', () => {
    const r = whiteOnly([...bad('misses-mate', 1), ...bad('walks-into-fork', 1)]);
    expect(gameSummary(r, 'w').practise).toMatchObject({ theme: 'fork' });
  });
  it('sends endgame mistakes to Endgames when the motif has no drill', () => {
    const r = whiteOnly([...bad('drifts', 2, 'endgame'), ...bad(null, 1, 'middlegame')]);
    expect(gameSummary(r, 'w').practise).toEqual({ kind: 'endgames', href: '/train/endgames', label: 'Endgames', reason: '2 of the 3 moves that lost ground came in the endgame.' });
  });
  it('falls back to the Blunder check otherwise', () => {
    expect(gameSummary(whiteOnly(bad(null, 2)), 'w').practise).toMatchObject({ kind: 'blunder-check' });
    expect(gameSummary(whiteOnly(bad('drifts', 3, 'endgame').slice(0, 1)), 'w').practise).toMatchObject({ kind: 'blunder-check' });
  });
  it('counts only the reader, or both sides when unknown', () => {
    const r = report([...bad('walks-into-fork', 1), ...bad('hangs-piece', 1)]);
    expect(gameSummary(r, 'w').practise).toMatchObject({ theme: 'fork' });
    expect(gameSummary(r, 'b').practise).toMatchObject({ kind: 'blunder-check' });
    expect(gameSummary(r, null).practise?.reason).toMatch(/^Black /);
    expect(gameSummary(report([...bad('hangs-piece', 2)]), null).practise?.reason).toBe('Both sides left a piece hanging 2 times in this game.');
  });
  it('only points at themes that exist as Train themes', () => {
    const themes = Object.values(MOTIF_PRACTISE).flatMap((m) => (m?.drill && m.drill.kind === 'theme' ? [m.drill.theme] : []));
    expect(themes.sort()).toEqual(['defensiveMove', 'fork', 'mateIn2']);
  });
});
