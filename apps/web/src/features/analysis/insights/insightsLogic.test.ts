import { describe, expect, it } from 'vitest';
import { REPORT_VERSION, type AnalysedMove, type GameReport, type MoveClass, type Motif } from '@knightfall/core';
import {
  accuracyAxis, accuracyGeometry, buildInsights, motifSummary, motifTheme, reviewHref, staleKeys, updateLine, weakestPhase,
  type InsightGameInfo, type InsightInput, type KnownUsers,
} from './insightsLogic.ts';

const NO_USERS: KnownUsers = { lichessUser: '', chesscomUser: '' };

function counts(over: Partial<Record<MoveClass, number>> = {}): Record<MoveClass, number> {
  const base = Object.fromEntries(['book', 'forced', 'brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'miss'].map((c) => [c, 0])) as Record<MoveClass, number>;
  return { ...base, ...over };
}

function move(ply: number, cls: MoveClass, motif: Motif, epLoss = 0.2): AnalysedMove {
  return {
    ply, color: ply % 2 === 0 ? 'w' : 'b', moveNumber: Math.floor(ply / 2) + 1, san: `m${ply}`, uci: 'a1a2', fenBefore: '', fenAfter: '', class: cls, phase: 'middlegame',
    winBefore: 50, winAfter: 40, epLoss, accuracy: 50, cpLoss: 50, insight: { motif },
  };
}

interface FakeOpts {
  acc?: [number | null, number | null];
  phases?: [number | null, number | null, number | null];
  moves?: AnalysedMove[];
  counts?: { white?: Partial<Record<MoveClass, number>>; black?: Partial<Record<MoveClass, number>> };
  opening?: string | null;
  version?: number;
}

function report(o: FakeOpts = {}): GameReport {
  const [wa, ba] = o.acc ?? [80, 60];
  const [op, mi, en] = o.phases ?? [90, 70, 50];
  const ph = (v: number | null) => ({ white: v, black: v === null ? null : v - 10 });
  return {
    version: (o.version ?? REPORT_VERSION) as typeof REPORT_VERSION,
    startFen: '', moves: o.moves ?? [], evals: [],
    accuracy: { white: wa, black: ba },
    ratingAccuracy: { white: null, black: null }, estimatedRating: { white: null, black: null },
    advanced: { opening: { white: null, black: null }, tactics: { white: null, black: null }, strategy: { white: null, black: null }, endgame: { white: null, black: null } },
    acpl: { white: null, black: null },
    counts: { white: counts(o.counts?.white), black: counts(o.counts?.black) },
    phases: { opening: ph(op), middlegame: ph(mi), endgame: ph(en) },
    keyMoments: [],
    opening: o.opening === null ? null : { eco: 'C50', name: o.opening ?? 'Italian Game', ply: 6 },
  };
}

function game(key: string, over: Partial<InsightGameInfo> = {}): InsightGameInfo {
  return { key, source: 'lichess', white: { name: 'Me' }, black: { name: 'Them' }, result: '1-0', playedAt: 1000, importedFor: 'me', ...over };
}

const input = (key: string, o: FakeOpts = {}, g: Partial<InsightGameInfo> = {}): InsightInput => ({ game: game(key, g), report: report(o) });

describe('buildInsights: sides and accuracy', () => {
  it('averages the user side, split by colour, ordered by date; skips unknown sides and old versions', () => {
    const inputs = [
      input('c', { acc: [70, 50] }, { playedAt: 3000 }), // white: 70
      input('a', { acc: [90, 40] }, { playedAt: 1000, white: { name: 'Them' }, black: { name: 'Me' } }), // black: 40
      input('b', { acc: [80, 60] }, { playedAt: 2000 }), // white: 80
      input('x', { acc: [10, 10] }, { importedFor: undefined }), // unknown
      input('old', { version: 2, acc: [10, 10] }),
    ];
    const d = buildInsights(inputs, NO_USERS, REPORT_VERSION);
    expect(d.games).toBe(3);
    expect(d.unknownSide).toBe(1);
    expect(d.outdated).toBe(1);
    expect(d.accuracySeries.map((p) => [p.gameKey, p.accuracy, p.side])).toEqual([['a', 40, 'b'], ['b', 80, 'w'], ['c', 70, 'w']]);
    expect(d.accuracy).toMatchObject({ white: 75, black: 40, overall: 63.3, whiteGames: 2, blackGames: 1 });
  });

  it('uses remembered usernames for games without importedFor', () => {
    const d = buildInsights([input('a', {}, { importedFor: undefined })], { lichessUser: 'Me', chesscomUser: '' }, REPORT_VERSION);
    expect(d.games).toBe(1);
    expect(d.unknownSide).toBe(0);
  });

  it('skips null accuracies and handles no games', () => {
    const d = buildInsights([input('a', { acc: [null, null] })], NO_USERS, REPORT_VERSION);
    expect(d.games).toBe(1);
    expect(d.accuracySeries).toEqual([]);
    expect(d.accuracy.overall).toBeNull();
    const none = buildInsights([], NO_USERS, REPORT_VERSION);
    expect(none.games).toBe(0);
    expect(none.perGame).toEqual({ blunder: 0, mistake: 0, miss: 0, inaccuracy: 0 });
  });
});

describe('phases', () => {
  it('averages per phase for the user side and calls out the weakest', () => {
    const d = buildInsights([input('a', { phases: [90, 70, 50] }), input('b', { phases: [80, 60, null] })], NO_USERS, REPORT_VERSION);
    expect(d.phases.map((p) => [p.phase, p.accuracy, p.games])).toEqual([['opening', 85, 2], ['middlegame', 65, 2], ['endgame', 50, 1]]);
    expect(d.weakestPhase).toBe('endgame');
  });
  it('needs two phases with data', () => {
    expect(weakestPhase([{ phase: 'opening', accuracy: 80, games: 1 }, { phase: 'middlegame', accuracy: null, games: 0 }, { phase: 'endgame', accuracy: null, games: 0 }])).toBeNull();
  });
});

describe('per-game counts', () => {
  it('counts the user side only and averages per game', () => {
    const d = buildInsights(
      [
        input('a', { counts: { white: { blunder: 2, mistake: 1, miss: 3, inaccuracy: 4 }, black: { blunder: 9 } } }),
        input('b', { counts: { white: { blunder: 0, mistake: 3, miss: 1, inaccuracy: 0 }, black: { blunder: 9 } } }),
      ],
      NO_USERS,
      REPORT_VERSION,
    );
    expect(d.totals).toEqual({ blunder: 2, mistake: 4, miss: 4, inaccuracy: 4 });
    expect(d.perGame).toEqual({ blunder: 1, mistake: 2, miss: 2, inaccuracy: 2 });
  });
});

describe('motifs', () => {
  it('counts only the user bad moves, ranks by count, keeps 3 worst examples with links', () => {
    const moves = [
      move(0, 'blunder', 'hangs-piece', 0.5),
      move(2, 'mistake', 'hangs-piece', 0.3),
      move(4, 'inaccuracy', 'hangs-piece', 0.1),
      move(6, 'blunder', 'hangs-piece', 0.4),
      move(8, 'blunder', 'walks-into-fork', 0.4),
      move(1, 'blunder', 'hangs-piece', 0.9), // opponent's move
      move(10, 'best', 'hangs-piece', 0), // not bad
      move(12, 'mistake', 'none', 0.2), // no motif to show
    ];
    const d = buildInsights([input('g1', { moves }), input('g2', { moves: [move(0, 'miss', 'hangs-piece', 0.6)] })], NO_USERS, REPORT_VERSION);
    expect(d.motifs.map((m) => [m.motif, m.count, m.games])).toEqual([['hangs-piece', 5, 2], ['walks-into-fork', 1, 1]]);
    const hang = d.motifs[0];
    expect(hang.label).toBe('Left a piece hanging');
    expect(hang.theme).toBe('hangingPiece');
    expect(hang.examples.map((e) => [e.gameKey, e.ply])).toEqual([['g2', 0], ['g1', 0], ['g1', 6]]);
    expect(hang.examples[1].href).toBe('/analysis/g1?ply=1');
    expect(hang.examples[0]).toMatchObject({ opponent: 'Them', san: 'm0', class: 'miss' });
    expect(d.motifs[1].theme).toBe('fork');
  });

  it('theme mapping and wording', () => {
    expect(motifTheme('walks-into-fork')).toBe('fork');
    expect(motifTheme('misses-mate')).toBe('mateIn2');
    expect(motifTheme('loses-material')).toBeNull();
    expect(motifSummary(14, 9)).toBe('14 times in 9 games');
    expect(motifSummary(1, 1)).toBe('1 time in 1 game');
    expect(reviewHref('li-abc', 11)).toBe('/analysis/li-abc?ply=12');
  });
});

describe('openings', () => {
  it('lists openings played twice or more with score and accuracy for the user', () => {
    const d = buildInsights(
      [
        input('a', { opening: 'Italian Game', acc: [80, 0] }, { result: '1-0' }),
        input('b', { opening: 'Italian Game', acc: [60, 0] }, { result: '1/2-1/2' }),
        input('c', { opening: 'Italian Game', acc: [70, 0] }, { result: '0-1' }),
        input('d', { opening: 'Sicilian Defense', acc: [0, 50] }, { result: '0-1', white: { name: 'Them' }, black: { name: 'Me' } }),
        input('e', { opening: 'Sicilian Defense', acc: [0, 70] }, { result: '1-0', white: { name: 'Them' }, black: { name: 'Me' } }),
        input('f', { opening: 'Caro-Kann' }),
        input('g', { opening: null }),
      ],
      NO_USERS,
      REPORT_VERSION,
    );
    expect(d.openings.map((o) => [o.name, o.games, o.wins, o.draws, o.losses, o.score, o.accuracy])).toEqual([
      ['Italian Game', 3, 1, 1, 1, 0.5, 70],
      ['Sicilian Defense', 2, 1, 0, 1, 0.5, 60],
    ]);
  });
  it('falls back to the stored game opening name', () => {
    const d = buildInsights([input('a', { opening: null }, { opening: { name: 'Scotch' } }), input('b', { opening: null }, { opening: { name: 'Scotch' } })], NO_USERS, REPORT_VERSION);
    expect(d.openings[0]).toMatchObject({ name: 'Scotch', games: 2 });
  });
});

describe('update helpers', () => {
  it('finds stale reports and words the progress line', () => {
    expect(staleKeys([{ gameKey: 'a', report: { version: 2 } }, { gameKey: 'b', report: { version: REPORT_VERSION } }, { gameKey: 'c', report: { version: 1 } }], REPORT_VERSION)).toEqual(['a', 'c']);
    expect(updateLine(2, 12)).toBe('Updating 3 of 12 reviews');
    expect(updateLine(0, 1)).toBe('Updating 1 of 1 review');
    expect(updateLine(5, 5)).toBe('Updating 5 of 5 reviews');
  });
});

describe('accuracy chart geometry', () => {
  it('uses whole tens, at least 20 tall, inside 0..100', () => {
    expect(accuracyAxis([72, 81])).toEqual({ min: 60, max: 90 });
    expect(accuracyAxis([98, 99])).toEqual({ min: 80, max: 100 });
    expect(accuracyAxis([3])).toEqual({ min: 0, max: 20 });
    expect(accuracyAxis([])).toEqual({ min: 0, max: 100 });
  });
  it('maps values into the box', () => {
    const g = accuracyGeometry([60, 90], 100, 60, 10);
    expect(g.xy).toEqual([{ x: 10, y: 42 }, { x: 90, y: 18 }]);
    expect(g.line).toBe('M10 42 L90 18');
    expect(accuracyGeometry([], 100, 60, 10).xy).toEqual([]);
    expect(accuracyGeometry([75], 100, 60, 10).xy[0].x).toBe(50);
  });
});
