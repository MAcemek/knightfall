import { describe, expect, it } from 'vitest';
import type { AnalysedMove, EvalScore, GameReport, MoveClass, PositionEval, Puzzle } from '@knightfall/core';
import type { StoredGame } from '../../shared/db.ts';
import {
  addOutcome, addToTally, decide, dayCount, EMPTY_TALLY, EMPTY_TOTALS, enemyForcing, enterMove, fromGames, fromPuzzle, gamesUsable,
  isForcingMove, judgeRefutation, lastDays, makeAlternator, makeDeck, missedForcing, parseChoice, sanitizeTotals, listedSummary, tallyPercent, verdictText,
  type CheckItem, type Rng,
} from './blunderLogic.ts';

function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

const pe = (fen: string, lines: { pv: string[]; score: EvalScore }[], extra: Partial<PositionEval> = {}): PositionEval => ({
  fen, depth: 14, source: 'engine', lines, score: lines[0]?.score ?? { cp: 0 }, ...extra,
});

function mv(ply: number, cls: MoveClass, over: Partial<AnalysedMove> = {}): AnalysedMove {
  return {
    ply, color: ply % 2 === 0 ? 'w' : 'b', moveNumber: Math.floor(ply / 2) + 1, san: 'e4', uci: 'e2e4', fenBefore: START, fenAfter: AFTER_E4,
    class: cls, phase: 'middlegame', winBefore: 50, winAfter: 50, epLoss: 0, accuracy: 100, cpLoss: 0, ...over,
  };
}

const game = (key = 'g1', over: Partial<StoredGame> = {}): StoredGame => ({
  key, source: 'lichess', pgn: '', white: { name: 'Mina' }, black: { name: 'Other' }, result: '1-0', playedAt: 0, importedAt: 0, plies: 4, importedFor: 'mina', ...over,
});
const USERS = { lichessUser: '', chesscomUser: '' };

function report(moves: AnalysedMove[], evals: PositionEval[]): GameReport {
  return { version: 3, startFen: START, moves, evals } as unknown as GameReport;
}

describe('enemyForcing', () => {
  it('lists checks and captures once per square pair', () => {
    // Black to move: Bxg2? Build a position with a capture and a check.
    const fen = '4k3/8/8/8/3n4/8/4P3/4K2R b - - 0 1';
    const moves = enemyForcing(fen);
    const sans = moves.map((m) => m.san).sort();
    expect(sans).toEqual(['Nc2+', 'Nf3+', 'Nxe2']);
    expect(moves.find((m) => m.san === 'Nxe2')).toMatchObject({ capture: true, check: false });
    expect(moves.find((m) => m.san === 'Nf3+')).toMatchObject({ capture: false, check: true });
  });

  it('counts a promotion once and keeps its capture flag', () => {
    const fen = '1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const list = enemyForcing(fen);
    expect(list.filter((m) => m.from === 'a7')).toHaveLength(1);
    expect(list[0]?.capture).toBe(true);
    expect(list[0]?.to).toBe('b8');
  });

  it('gives nothing for a bad position', () => {
    expect(enemyForcing('nonsense')).toEqual([]);
  });

  it('isForcingMove accepts checks and captures and refuses quiet or illegal moves', () => {
    const fen = '4k3/8/8/8/3n4/8/4P3/4K2R b - - 0 1';
    expect(isForcingMove(fen, 'd4e2')).toBe(true);
    expect(isForcingMove(fen, 'd4b5')).toBe(false);
    expect(isForcingMove(fen, 'a1a2')).toBe(false);
  });

  it('enterMove tells added, repeat, quiet and illegal apart', () => {
    const fen = '4k3/8/8/8/3n4/8/4P3/4K2R b - - 0 1';
    expect(enterMove(fen, [], 'd4e2')).toBe('added');
    expect(enterMove(fen, ['d4e2'], 'd4e2')).toBe('repeat');
    expect(enterMove(fen, [], 'd4b5')).toBe('quiet');
    expect(enterMove(fen, [], 'h1h8')).toBe('illegal');
    expect(missedForcing(fen, ['d4e2']).map((m) => m.san).sort()).toEqual(['Nc2+', 'Nf3+']);
    expect(missedForcing(fen, ['d4e2', 'd4f3', 'd4c2'])).toEqual([]);
  });
});

describe('fromGames', () => {
  const blunderMove = mv(0, 'blunder', { san: 'Nc3', uci: 'b1c3', fenBefore: START, fenAfter: 'rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/R1BQKBNR b KQkq - 1 1', cpLoss: 320 });
  const afterBlunder = pe(blunderMove.fenAfter, [{ pv: ['b8c6'], score: { cp: -300 } }]);

  it('makes a blunder item with the refutation from the next position', () => {
    const rep = report([blunderMove], [pe(START, [{ pv: ['e2e4'], score: { cp: 20 } }]), afterBlunder]);
    const items = fromGames([{ game: game(), report: rep }], USERS);
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0).toMatchObject({ blunder: true, reply: 'b8c6', mover: 'w', source: 'games', gameKey: 'g1', ply: 0, planned: 'b1c3' });
    expect(it0.note).toContain('Best reply: Nc6');
    expect(it0.note).toContain('about 3.2 pawns');
  });

  it('skips a blunder without a reply line or with an illegal one', () => {
    const none = report([blunderMove], [pe(START, []), pe(blunderMove.fenAfter, [])]);
    expect(fromGames([{ game: game(), report: none }], USERS)).toEqual([]);
    const bad = report([blunderMove], [pe(START, []), pe(blunderMove.fenAfter, [{ pv: ['a1a8'], score: { cp: -300 } }])]);
    expect(fromGames([{ game: game(), report: bad }], USERS)).toEqual([]);
  });

  it('mentions mate when the move allows it', () => {
    const rep = report([blunderMove], [pe(START, []), pe(blunderMove.fenAfter, [{ pv: ['b8c6'], score: { mate: -3 } }])]);
    expect(fromGames([{ game: game(), report: rep }], USERS)[0].note).toContain('mate in 3');
  });

  it('makes safe items only from the good classes and only for the player', () => {
    const evals = [pe(START, []), pe(AFTER_E4, [{ pv: ['e7e5'], score: { cp: 20 } }]), pe(START, [])];
    const classes: MoveClass[] = ['best', 'great', 'brilliant', 'excellent', 'good', 'inaccuracy', 'book'];
    for (const cls of classes) {
      const items = fromGames([{ game: game(), report: report([mv(0, cls, { phase: 'middlegame' })], evals.slice(0, 2)) }], USERS);
      expect(items.length).toBe(cls === 'inaccuracy' ? 0 : 1);
    }
    // Opponent's move is not the player's.
    const theirs = report([mv(1, 'best', { color: 'b', fenBefore: AFTER_E4 })], [pe(START, []), pe(AFTER_E4, []), pe(START, [])]);
    expect(fromGames([{ game: game(), report: theirs }], USERS)).toEqual([]);
  });

  it('refuses book moves in the opening, forced single moves and missing next evaluations', () => {
    const evals = [pe(START, []), pe(AFTER_E4, [])];
    expect(fromGames([{ game: game(), report: report([mv(0, 'book', { phase: 'opening' })], evals) }], USERS)).toEqual([]);
    const onlyMove = '1r5k/8/8/8/8/8/8/K7 w - - 0 1';
    const forced = mv(0, 'best', { fenBefore: onlyMove, fenAfter: '1r5k/8/8/8/8/8/K7/8 b - - 1 1', san: 'Ka2', uci: 'a1a2' });
    expect(fromGames([{ game: game(), report: report([forced], evals) }], USERS)).toEqual([]);
    const short = report([mv(0, 'best')], [pe(START, [])]);
    expect(fromGames([{ game: game(), report: short }], USERS)).toEqual([]);
  });

  it('skips games where the side is unknown', () => {
    const rep = report([mv(0, 'best')], [pe(START, []), pe(AFTER_E4, [])]);
    expect(fromGames([{ game: game('x', { importedFor: undefined }), report: rep }], USERS)).toEqual([]);
    expect(fromGames([{ game: game('x', { importedFor: undefined }), report: rep }], { lichessUser: 'MINA', chesscomUser: '' })).toHaveLength(1);
  });

  it('never makes two items for the same ply of one game', () => {
    const rep = report([mv(0, 'best')], [pe(START, []), pe(AFTER_E4, [])]);
    const items = fromGames([{ game: game(), report: rep }, { game: game(), report: rep }], USERS);
    expect(items).toHaveLength(1);
  });

  it('gamesUsable needs four items and two of each kind', () => {
    const mk = (id: string, blunder: boolean) => ({ id, blunder }) as CheckItem;
    expect(gamesUsable([mk('1', true), mk('2', false), mk('3', false)])).toBe(false);
    expect(gamesUsable([mk('1', false), mk('2', false), mk('3', false), mk('4', false)])).toBe(false);
    expect(gamesUsable([mk('1', true), mk('2', false), mk('3', false), mk('4', false)])).toBe(false);
    expect(gamesUsable([mk('1', true), mk('2', true), mk('3', false), mk('4', false)])).toBe(true);
  });
});

describe('fromPuzzle', () => {
  const puzzle: Puzzle = { id: 'pz1', fen: START, moves: ['b1c3', 'd7d5'], opponentFirst: true, rating: 1500, themes: [], source: 'lichess' };
  const before = pe(START, [
    { pv: ['g1f3'], score: { cp: 30 } },
    { pv: ['e2e4'], score: { cp: 20 } },
    { pv: ['b1c3'], score: { cp: -10 } },
    { pv: ['a2a3'], score: { cp: -60 } },
  ]);
  const AFTER_NC3 = 'rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/R1BQKBNR b KQkq - 1 1';
  const afterBlunder = pe(AFTER_NC3, [{ pv: ['d7d5'], score: { cp: -300 } }]);

  it('makes a blunder item from the puzzle line', () => {
    const it0 = fromPuzzle(puzzle, before, afterBlunder, true, seeded(1));
    expect(it0).toMatchObject({ blunder: true, planned: 'b1c3', plannedSan: 'Nc3', reply: 'd7d5', mover: 'w', fenAfter: AFTER_NC3, id: 'p:pz1:b' });
    expect(it0?.note).toContain('Best reply: d5');
    expect(it0?.puzzle).toBe(puzzle);
  });

  it('makes a safe item from a line within 50 centipawns that is not the blunder', () => {
    for (let s = 1; s < 20; s++) {
      const it0 = fromPuzzle(puzzle, before, afterBlunder, false, seeded(s));
      expect(it0?.blunder).toBe(false);
      expect(['g1f3', 'e2e4']).toContain(it0?.planned);
      expect(it0?.reply).toBeNull();
    }
    const picks = new Set(Array.from({ length: 30 }, (_, s) => fromPuzzle(puzzle, before, afterBlunder, false, seeded(s))?.planned));
    expect(picks.size).toBe(2);
  });

  it('refuses a safe item when no other line is close enough', () => {
    const lonely = pe(START, [{ pv: ['b1c3'], score: { cp: 30 } }, { pv: ['g1f3'], score: { cp: -100 } }, { pv: ['a2a3'], score: { cp: -200 } }]);
    expect(fromPuzzle(puzzle, lonely, afterBlunder, false, seeded(1))).toBeNull();
    expect(fromPuzzle(puzzle, lonely, afterBlunder, true, seeded(1))).not.toBeNull();
  });

  it('rejects a blunder that costs under 150 centipawns', () => {
    const mild = pe(AFTER_NC3, [{ pv: ['d7d5'], score: { cp: -100 } }]);
    expect(fromPuzzle(puzzle, before, mild, true, seeded(1))).toBeNull();
    expect(fromPuzzle(puzzle, before, mild, false, seeded(1))).toBeNull();
  });

  it('reads the loss from the mover side (Black blunders)', () => {
    const blackPuzzle: Puzzle = { ...puzzle, id: 'pz2', fen: AFTER_E4, moves: ['a7a6', 'd2d4'] };
    const b = pe(AFTER_E4, [{ pv: ['e7e5'], score: { cp: -20 } }, { pv: ['c7c5'], score: { cp: 0 } }]);
    const after = pe('', [{ pv: ['d2d4'], score: { cp: 300 } }]);
    expect(fromPuzzle(blackPuzzle, b, after, true, seeded(1))?.mover).toBe('b');
    // The same White-POV score is a gain for White, so it is no blunder by White.
    const wrong = pe('', [{ pv: ['d2d4'], score: { cp: -100 } }]);
    expect(fromPuzzle(blackPuzzle, b, wrong, true, seeded(1))).toBeNull();
  });

  it('counts mate as a huge loss', () => {
    const mated = pe(AFTER_NC3, [], { score: { mate: -2 } });
    const it0 = fromPuzzle(puzzle, before, mated, true, seeded(1));
    expect(it0?.blunder).toBe(true);
    expect(it0?.note).toContain('mate in 2');
  });

  it('rejects positions with fewer than 2 legal moves, no setup move or an illegal line', () => {
    expect(fromPuzzle({ ...puzzle, fen: '7k/5Q2/8/8/8/8/8/K7 b - - 0 1', moves: ['h8g8', 'f7f8'] }, before, afterBlunder, true, seeded(1))).toBeNull();
    expect(fromPuzzle({ ...puzzle, opponentFirst: false }, before, afterBlunder, true, seeded(1))).toBeNull();
    expect(fromPuzzle({ ...puzzle, moves: ['b1c3'] }, before, afterBlunder, true, seeded(1))).toBeNull();
    expect(fromPuzzle({ ...puzzle, moves: ['b1c3', 'a1a8'] }, before, afterBlunder, true, seeded(1))).toBeNull();
    expect(fromPuzzle(puzzle, pe(START, []), afterBlunder, true, seeded(1))).toBeNull();
  });
});

describe('deck', () => {
  const mk = (id: string, blunder: boolean): CheckItem => ({ id, blunder, source: 'games' }) as CheckItem;
  const items = [...Array.from({ length: 5 }, (_, i) => mk(`b${i}`, true)), ...Array.from({ length: 5 }, (_, i) => mk(`s${i}`, false))];

  it('alternator is a fair coin per draw with runs of at most 3', () => {
    const next = makeAlternator(seeded(3));
    const kinds = Array.from({ length: 2000 }, () => next());
    const blunders = kinds.filter(Boolean).length;
    expect(blunders).toBeGreaterThan(900);
    expect(blunders).toBeLessThan(1100);
    let run = 1;
    let longest = 1;
    for (let i = 1; i < kinds.length; i++) {
      run = kinds[i] === kinds[i - 1] ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBe(3);
  });

  it('the kind after an item is not decided by the one before, except after a run of 3', () => {
    const next = makeAlternator(seeded(9));
    const kinds = Array.from({ length: 4000 }, () => next());
    let afterTrue = 0, afterTrueTrue = 0;
    for (let i = 1; i < kinds.length; i++) {
      if (!kinds[i - 1]) continue;
      afterTrue++;
      if (kinds[i]) afterTrueTrue++;
    }
    expect(afterTrueTrue / afterTrue).toBeGreaterThan(0.35);
    expect(afterTrueTrue / afterTrue).toBeLessThan(0.65);
    // A run of 3 is always followed by the other kind.
    for (let i = 3; i < kinds.length; i++) {
      if (kinds[i - 1] === kinds[i - 2] && kinds[i - 2] === kinds[i - 3]) expect(kinds[i]).toBe(!kinds[i - 1]);
    }
  });

  it('a deck is about 50/50 and never has more than three of a kind in a row', () => {
    const deck = makeDeck(items, seeded(7));
    const kinds: boolean[] = [];
    for (let i = 0; i < 2000; i++) kinds.push(deck.next()?.blunder ?? false);
    const blunders = kinds.filter(Boolean).length;
    expect(blunders).toBeGreaterThan(900);
    expect(blunders).toBeLessThan(1100);
    for (let i = 3; i < kinds.length; i++) expect(kinds[i] === kinds[i - 1] && kinds[i] === kinds[i - 2] && kinds[i] === kinds[i - 3]).toBe(false);
  });

  it('does not repeat an item until all items of its kind were used', () => {
    const deck = makeDeck(items, seeded(11));
    const drawn = Array.from({ length: 80 }, () => deck.next()!);
    for (const kind of [true, false]) {
      const ids = drawn.filter((i) => i.blunder === kind).map((i) => i.id);
      for (let r = 0; r + 5 <= ids.length; r += 5) expect(new Set(ids.slice(r, r + 5)).size).toBe(5);
      // The seam between two rounds never repeats an item back to back.
      for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
    }
  });

  it('is repeatable for one seed, differs between seeds, and counts a repeated id once', () => {
    const a = makeDeck(items, seeded(5));
    const b = makeDeck([...items, ...items], seeded(5));
    const c = makeDeck(items, seeded(6));
    const seqA = Array.from({ length: 10 }, () => a.next()!.id);
    expect(Array.from({ length: 10 }, () => b.next()!.id)).toEqual(seqA);
    expect(Array.from({ length: 10 }, () => c.next()!.id)).not.toEqual(seqA);
  });

  it('copes with one kind only and with nothing', () => {
    const only = makeDeck(items.filter((i) => i.blunder), seeded(2));
    expect(only.next()?.blunder).toBe(true);
    expect(only.next()?.blunder).toBe(true);
    expect(makeDeck([], seeded(2)).next()).toBeNull();
  });
});

describe('listedSummary', () => {
  const m = (san: string) => ({ from: 'a1', to: 'a2', san, check: false, capture: true });
  it('lists up to four missed moves and counts the rest', () => {
    expect(listedSummary(3, 3, [])).toBe('You listed 3 of 3.');
    expect(listedSummary(1, 3, [m('Bg4+'), m('Bg2+')])).toBe('You listed 1 of 3. Missed: Bg4+, Bg2+');
    expect(listedSummary(0, 6, ['a', 'b', 'c', 'd', 'e', 'f'].map(m))).toBe('You listed 0 of 6. Missed: a, b, c, d and 2 more');
    expect(listedSummary(1, 5, ['a', 'b', 'c', 'd'].map(m))).toBe('You listed 1 of 5. Missed: a, b, c, d');
  });
});

describe('verdicts', () => {
  const NC3_AFTER = 'rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/R1BQKBNR b KQkq - 1 1';
  const base = {
    id: 'x', source: 'games', fen: START, fenAfter: NC3_AFTER, planned: 'b1c3', plannedSan: 'Nc3', mover: 'w', note: '',
  } as const;
  const evalAfter = pe(NC3_AFTER, [
    { pv: ['d7d5'], score: { cp: -300 } },
    { pv: ['e7e5'], score: { cp: -290 } },
    { pv: ['a7a6'], score: { cp: -50 } },
  ]);
  const blunder: CheckItem = { ...base, blunder: true, reply: 'd7d5', evalAfter };
  const safe: CheckItem = { ...base, blunder: false, reply: null };

  it('decides all four combinations', () => {
    expect(decide(safe, 'safe')).toBe('correct');
    expect(decide(blunder, 'safe')).toBe('missed');
    expect(decide(safe, 'blunder')).toBe('false-alarm');
    expect(decide(blunder, 'blunder')).toBe('ask');
  });

  it('accepts the stored reply and an equally good alternative from the engine lines', () => {
    expect(judgeRefutation(blunder, 'd7d5')).toBe('correct');
    expect(judgeRefutation(blunder, 'e7e5')).toBe('correct');
    expect(judgeRefutation(blunder, 'a7a6')).toBe('wrong-reason');
    expect(judgeRefutation(blunder, 'g8f6')).toBe('wrong-reason');
  });

  it('judges the enemy side, not the mover, so the signs are right when Black blundered', () => {
    const afterFen = 'rnbqkbnr/pppppppp/8/8/4P3/7N/PPPP1PPP/RNBQKB1R b KQkq - 1 1';
    const item: CheckItem = { ...base, mover: 'b', fenAfter: afterFen, blunder: true, reply: 'e4e5', evalAfter: pe('x', [{ pv: ['e4e5'], score: { cp: 300 } }, { pv: ['d2d4'], score: { cp: 280 } }, { pv: ['a2a3'], score: { cp: -100 } }]) };
    expect(judgeRefutation(item, 'd2d4')).toBe('correct');
    expect(judgeRefutation(item, 'a2a3')).toBe('wrong-reason');
  });

  it('uses the puzzle solution and its alternatives for puzzle items', () => {
    const puzzle: Puzzle = { id: 'p', fen: START, moves: ['b1c3', 'd7d5'], opponentFirst: true, rating: 1500, themes: [], source: 'lichess', alts: { 1: ['e7e5'] } };
    const item: CheckItem = { ...blunder, source: 'puzzles', puzzle, evalAfter: undefined };
    expect(judgeRefutation(item, 'd7d5')).toBe('correct');
    expect(judgeRefutation(item, 'e7e5')).toBe('correct');
    expect(judgeRefutation(item, 'a7a6')).toBe('wrong-reason');
  });

  it('a puzzle item falls back on the engine lines for another strong reply', () => {
    const puzzle: Puzzle = { id: 'p', fen: START, moves: ['b1c3', 'd7d5'], opponentFirst: true, rating: 1500, themes: [], source: 'lichess' };
    const item: CheckItem = { ...blunder, source: 'puzzles', puzzle };
    expect(judgeRefutation(item, 'e7e5')).toBe('correct');
  });

  it('any checkmate refutes, even when it is not in the stored lines', () => {
    const fenAfter = 'rrq3k1/8/8/8/8/8/6PP/7K b - - 0 1';
    const item: CheckItem = {
      ...base, fenAfter, blunder: true, reply: 'a8a1',
      evalAfter: pe(fenAfter, [{ pv: ['a8a1'], score: { mate: 1 } }, { pv: ['b8b1'], score: { mate: 1 } }]),
    };
    expect(judgeRefutation(item, 'c8c1')).toBe('correct');
    expect(judgeRefutation(item, 'a8a2')).toBe('wrong-reason');
  });

  it('the missed text depends on whether the refutation is forcing', () => {
    const quiet = verdictText('missed', { ...blunder, reply: 'a7a6' });
    expect(quiet.text).toBe('Nc3 allows a threat. Look at what they play next.');
    const forcingItem: CheckItem = { ...blunder, fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1', reply: 'e5d4' };
    expect(verdictText('missed', forcingItem).text).toBe('Nc3 loses to a check or a capture you could have seen.');
    expect(verdictText('false-alarm', safe).text).toBe('Nc3 holds up.');
  });

  it('a safe item never has a refutation', () => {
    expect(judgeRefutation(safe, 'd7d5')).toBe('wrong-reason');
  });
});

describe('totals', () => {
  it('adds each outcome to its own counter and returns new objects', () => {
    let t = EMPTY_TOTALS;
    t = addOutcome(t, '2026-03-02', 'correct');
    t = addOutcome(t, '2026-03-02', 'correct');
    t = addOutcome(t, '2026-03-02', 'wrong-reason');
    t = addOutcome(t, '2026-03-02', 'missed');
    t = addOutcome(t, '2026-03-02', 'false-alarm');
    expect(t.days['2026-03-02']).toEqual({ correct: 2, wrongReason: 1, missed: 1, falseAlarms: 1 });
    expect(dayCount(t, '2026-03-02')).toBe(5);
    expect(dayCount(t, '2026-03-03')).toBe(0);
    expect(EMPTY_TOTALS.days).toEqual({});
  });

  it('ignores a bad date key', () => {
    expect(addOutcome(EMPTY_TOTALS, 'today', 'correct').days).toEqual({});
    expect(addOutcome(EMPTY_TOTALS, '2026-02-30', 'correct').days).toEqual({});
  });

  it('sanitizes damaged data', () => {
    expect(sanitizeTotals(null)).toEqual({ days: {} });
    expect(sanitizeTotals('x')).toEqual({ days: {} });
    expect(sanitizeTotals({ days: [] })).toEqual({ days: {} });
    const t = sanitizeTotals({ days: { '2026-03-01': { correct: 3.9, wrongReason: -2, missed: 'a', falseAlarms: NaN }, bad: { correct: 1 }, '2026-03-02': null } });
    expect(t.days).toEqual({ '2026-03-01': { correct: 3, wrongReason: 0, missed: 0, falseAlarms: 0 } });
  });

  it('keeps the newest 120 days', () => {
    const days: Record<string, unknown> = {};
    for (let i = 0; i < 150; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      days[d] = { correct: 1, wrongReason: 0, missed: 0, falseAlarms: 0 };
    }
    const keys = Object.keys(sanitizeTotals({ days }).days).sort();
    expect(keys).toHaveLength(120);
    expect(keys[0]).toBe(new Date(Date.UTC(2026, 0, 31)).toISOString().slice(0, 10));
    const more = addOutcome({ days: sanitizeTotals({ days }).days }, '2027-01-01', 'missed');
    expect(Object.keys(more.days)).toHaveLength(120);
    expect(more.days['2027-01-01']?.missed).toBe(1);
  });

  it('lists the last days oldest first', () => {
    const t = addOutcome(addOutcome(EMPTY_TOTALS, '2026-03-02', 'correct'), '2026-03-02', 'missed');
    const week = lastDays(t, '2026-03-03', 3);
    expect(week.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(week[1]).toEqual({ date: '2026-03-02', total: 2, correct: 1 });
  });
});

describe('session tally and stored choice', () => {
  it('counts outcomes and percent', () => {
    let t = EMPTY_TALLY;
    expect(tallyPercent(t)).toBeNull();
    t = addToTally(t, 'correct');
    t = addToTally(t, 'missed');
    t = addToTally(t, 'correct');
    t = addToTally(t, 'false-alarm');
    expect(t).toMatchObject({ played: 4, correct: 2, missed: 1, falseAlarms: 1 });
    expect(tallyPercent(t)).toBe(50);
  });

  it('reads a stored choice and falls back on damage', () => {
    expect(parseChoice(JSON.stringify({ source: 'games', mode: 'full' }))).toEqual({ source: 'games', mode: 'full' });
    expect(parseChoice(null)).toEqual({ source: 'puzzles', mode: 'quick' });
    expect(parseChoice('{bad')).toEqual({ source: 'puzzles', mode: 'quick' });
    expect(parseChoice(JSON.stringify({ source: 3, mode: [] }))).toEqual({ source: 'puzzles', mode: 'quick' });
  });
});
