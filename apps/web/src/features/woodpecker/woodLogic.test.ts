import { describe, expect, it } from 'vitest';
import type { Puzzle } from '@knightfall/core';
import type { CustomPuzzle, WoodSet } from '../../shared/db.ts';
import {
  buildSet, canStartNext, capMs, cleanName, clampFirstDays, compareCycles, cycleProgress, cycleSummaries, formatMs, formatTotal, median,
  ownCounts, pace, canRecord, pickActive, planRecord, poolBuckets, startNextCycle, targetDays, CAP_MS,
} from './woodLogic.ts';

const FEN = '8/8/8/8/8/8/8/K6k w - - 0 1';
const pz = (id: string, rating: number, moves = ['a1a2']): Puzzle => ({ id, fen: FEN, moves, opponentFirst: false, rating, themes: ['mate'], source: 'lichess' });
const mine = (id: string, rating: number, createdAt: number): CustomPuzzle => ({
  ...pz(id, rating), source: 'custom', createdAt, updatedAt: createdAt, author: 'someone', plays: 3, solves: 1, title: 'T', gameUrl: 'https://example.test/g',
});
const at = (day: number, hour = 12) => new Date(2025, 0, day, hour).getTime();

function makeSet(n: number, over: Partial<WoodSet> = {}): WoodSet {
  return {
    id: 's1', createdAt: 1, name: 'Set',
    items: Array.from({ length: n }, (_, i) => pz(`p${i}`, 1000 + i)),
    cycles: [{ n: 1, startedAt: at(1), finishedAt: null, targetDays: 4 }],
    ...over,
  };
}
let rowId = 0;
const att = (puzzleId: string, over: Record<string, unknown> = {}) => ({
  id: ++rowId, puzzleId, mode: 'woodpecker' as const, setId: 's1', cycle: 1, solved: true, hintsUsed: 0, timeMs: 3000, at: at(1), puzzleRating: 1000, ...over,
});

describe('targetDays', () => {
  it('halves every cycle, rounded up, never below 1', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => targetDays(28, n))).toEqual([28, 14, 7, 4, 2, 1, 1, 1]);
  });
  it('clamps the first target and survives odd input', () => {
    expect(targetDays(500, 1)).toBe(90);
    expect(targetDays(0, 1)).toBe(1);
    expect(targetDays(Number.NaN, 1)).toBe(28);
    expect(clampFirstDays('12')).toBe(12);
    expect(targetDays(28, 0)).toBe(28);
  });
});

describe('cleanName / capMs', () => {
  it('trims, collapses spaces, limits length and falls back', () => {
    expect(cleanName('  a   b ')).toBe('a b');
    expect(cleanName('   ')).toBe('Woodpecker set');
    expect(cleanName('x'.repeat(200))).toHaveLength(60);
    expect(cleanName(5)).toBe('Woodpecker set');
  });
  it('caps solve time at 5 minutes', () => {
    expect(capMs(CAP_MS + 1)).toBe(CAP_MS);
    expect(capMs(-5)).toBe(0);
    expect(capMs(Number.NaN)).toBe(0);
    expect(capMs(1234.4)).toBe(1234);
  });
});

describe('poolBuckets', () => {
  it('covers the 200 points up to the rating', () => {
    const p = poolBuckets(1500);
    expect(p.low).toBe(1300);
    expect(p.high).toBe(1500);
    expect(p.main).toEqual([1300, 1400, 1500]);
  });
  it('widens downwards first, then upwards', () => {
    const p = poolBuckets(1500);
    expect(p.widen.slice(0, 3)).toEqual([1200, 1100, 1000]);
    const firstUp = p.widen.indexOf(1600);
    expect(firstUp).toBe(p.widen.indexOf(400) + 1);
    expect(p.widen.slice(-1)).toEqual([2900]);
    expect(new Set([...p.main, ...p.widen]).size).toBe(p.main.length + p.widen.length);
  });
  it('works at the edges', () => {
    const lo = poolBuckets(400);
    expect(lo.main).toEqual([400]);
    expect(lo.widen[0]).toBe(500);
    const hi = poolBuckets(3000);
    expect(hi.main).toEqual([2800, 2900]);
    expect(hi.widen[0]).toBe(2700);
    expect(hi.widen.every((b) => b >= 400 && b <= 2900)).toBe(true);
    expect(poolBuckets(Number.NaN).main.length).toBeGreaterThan(0);
  });
});

describe('buildSet', () => {
  const pool = Array.from({ length: 50 }, (_, i) => pz(`l${i}`, 1100 + i * 4));
  it('puts picks first, then game puzzles newest first, then the pool; sorted easy to hard', () => {
    const own = [mine('game-a-1', 1500, 10), mine('game-b-2', 900, 30), mine('game-c-3', 1700, 20), mine('custom-x', 1300, 99)];
    const set = buildSet({ picks: ['custom-x', 'game-a-1'], own, pool, size: 6, seed: 's' });
    const ids = set.map((p) => p.id);
    expect(ids).toHaveLength(6);
    // 2 picks + 2 other game puzzles + 2 from the pool
    for (const id of ['custom-x', 'game-a-1', 'game-b-2', 'game-c-3']) expect(ids).toContain(id);
    expect(ids.filter((id) => id.startsWith('l'))).toHaveLength(2);
    const ratings = set.map((p) => p.rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => a - b));
  });
  it('when the size is smaller than the own puzzles, picks win over the rest and newer games win', () => {
    const own = [mine('game-a-1', 1500, 10), mine('game-b-2', 900, 30), mine('game-c-3', 1700, 20)];
    const set = buildSet({ picks: ['game-a-1'], own, pool, size: 2, seed: 's' });
    expect(set.map((p) => p.id).sort()).toEqual(['game-a-1', 'game-b-2']);
  });
  it('is deterministic for a seed and differs for another', () => {
    const a = buildSet({ picks: [], own: [], pool, size: 10, seed: 'x' }).map((p) => p.id);
    expect(buildSet({ picks: [], own: [], pool, size: 10, seed: 'x' }).map((p) => p.id)).toEqual(a);
    expect(buildSet({ picks: [], own: [], pool, size: 10, seed: 'y' }).map((p) => p.id)).not.toEqual(a);
  });
  it('strips stored extras but keeps title, link and alts', () => {
    const own = [{ ...mine('game-a-1', 1500, 10), alts: { 0: ['a1b1'] } }];
    const [p] = buildSet({ picks: [], own, pool: [], size: 5, seed: 's' });
    expect(Object.keys(p).sort()).toEqual(['alts', 'fen', 'gameUrl', 'id', 'moves', 'opponentFirst', 'rating', 'source', 'themes', 'title']);
    expect(p.alts).toEqual({ 0: ['a1b1'] });
  });
  it('has unique ids, skips puzzles without moves and never exceeds the size', () => {
    const dup = [...pool, pz('l0', 1100), pz('empty', 1200, [])];
    const own = [mine('game-a-1', 1500, 1), { ...mine('game-z', 1500, 2), moves: [] }];
    const set = buildSet({ picks: ['game-a-1', 'game-a-1'], own, pool: [...dup, pz('game-a-1', 1500)], size: 20, seed: 's' });
    const ids = set.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
    expect(ids).not.toContain('empty');
    expect(ids).not.toContain('game-z');
  });
  it('uses widened puzzles only after the pool runs out, and may be shorter than the size', () => {
    const wide = [pz('w1', 500), pz('w2', 600)];
    const set = buildSet({ picks: [], own: [], pool: [pz('a', 1200), pz('b', 1210)], widened: wide, size: 3, seed: 's' });
    expect(set.map((p) => p.id)).toContain('a');
    expect(set.map((p) => p.id)).toContain('b');
    expect(set).toHaveLength(3);
    expect(buildSet({ picks: [], own: [], pool: [pz('a', 1)], widened: [], size: 3, seed: 's' })).toHaveLength(1);
  });
  it('does not change the inputs', () => {
    const own = [mine('game-a-1', 1500, 10)];
    const before = JSON.stringify(own);
    buildSet({ picks: [], own, pool, size: 5, seed: 's' });
    expect(JSON.stringify(own)).toBe(before);
  });
  it('counts own puzzles that will go in', () => {
    const own = [mine('game-a-1', 1500, 10), mine('game-b-2', 900, 30), mine('custom-x', 1, 1)];
    expect(ownCounts(['custom-x', 'gone'], own, 100)).toEqual({ picked: 1, games: 2 });
    expect(ownCounts([], own, 1)).toEqual({ picked: 0, games: 1 });
  });
});

describe('cycleProgress', () => {
  const set = makeSet(5);
  it('counts first attempts only, a duplicate row changes nothing', () => {
    const base = [att('p0'), att('p1', { solved: false, at: at(1, 13) })];
    const a = cycleProgress(set, 1, base);
    const b = cycleProgress(set, 1, [...base, att('p1', { solved: true, at: at(1, 14) }), att('p0', { solved: false, at: at(1, 15) })]);
    expect(b).toEqual(a);
    expect(a).toMatchObject({ total: 5, done: 2, passed: 1, firstUnplayed: 2, misses: ['p1'], accuracy: 0.5, finished: false });
  });
  it('a solved puzzle with hints is not a pass', () => {
    const p = cycleProgress(set, 1, [att('p0', { hintsUsed: 1 })]);
    expect(p.passed).toBe(0);
    expect(p.misses).toEqual(['p0']);
  });
  it('the earliest row is the first attempt even when listed later', () => {
    const p = cycleProgress(set, 1, [att('p0', { solved: true, at: at(1, 15) }), att('p0', { solved: false, at: at(1, 10) })]);
    expect(p.misses).toEqual(['p0']);
  });
  it('ignores other sets, other cycles, other modes and puzzles not in the set', () => {
    const p = cycleProgress(set, 1, [att('p0', { setId: 'other' }), att('p1', { cycle: 2 }), att('p2', { mode: 'rated' }), att('zzz')]);
    expect(p.done).toBe(0);
    expect(p.accuracy).toBeNull();
    expect(p.medianMs).toBeNull();
    expect(p.firstUnplayed).toBe(0);
  });
  it('times: total and median over first attempts, each capped', () => {
    const p = cycleProgress(set, 1, [att('p0', { timeMs: 1000 }), att('p1', { timeMs: 5000 }), att('p2', { timeMs: 99 * 60_000 }), att('p1', { timeMs: 9 })]);
    expect(p.totalMs).toBe(1000 + 5000 + CAP_MS);
    expect(p.medianMs).toBe(5000);
    expect(median([1, 3])).toBe(2);
    expect(median([])).toBeNull();
  });
  it('first unplayed follows set order, and finishing is reported', () => {
    expect(cycleProgress(set, 1, [att('p0'), att('p2')]).firstUnplayed).toBe(1);
    const all = set.items.map((p) => att(p.id));
    expect(cycleProgress(set, 1, all)).toMatchObject({ done: 5, finished: true, firstUnplayed: -1 });
    expect(cycleProgress(makeSet(0), 1, []).finished).toBe(false);
  });
});

describe('pace', () => {
  const set = makeSet(200, { cycles: [{ n: 1, startedAt: at(1, 9), finishedAt: null, targetDays: 28 }] });
  const play = (n: number, day: number, hour = 12) => Array.from({ length: n }, (_, i) => att(`p${i + 100 * 0}`, { at: at(day, hour) })).map((a, i) => ({ ...a, puzzleId: `p${i}` }));
  it('day one asks for ceil(total / target)', () => {
    const p = pace(set, 1, [], at(1, 20));
    expect(p).toMatchObject({ dayIndex: 1, expectedDone: 8, done: 0, doneToday: 0, todayQuota: 8, todayGoal: 8, state: 'on-pace' });
  });
  it('doing more than today asks is ahead; doing it exactly is on pace with nothing left', () => {
    const ahead = pace(set, 1, play(12, 1), at(1, 20));
    expect(ahead).toMatchObject({ doneToday: 12, todayQuota: 0, todayGoal: 8, state: 'ahead' });
    const exact = pace(set, 1, play(8, 1), at(1, 20));
    expect(exact).toMatchObject({ todayQuota: 0, state: 'on-pace' });
  });
  it('is behind when earlier days are not caught up, and counts the start day as 1', () => {
    const p = pace(set, 1, play(8, 1), at(4, 8));
    expect(p.dayIndex).toBe(4);
    expect(p.expectedDone).toBe(Math.ceil((200 * 4) / 28));
    expect(p.doneToday).toBe(0);
    expect(p.state).toBe('behind');
    expect(p.todayQuota).toBe(p.expectedDone - 8);
  });
  it('uses local days: late evening and early morning are different days', () => {
    const late = [att('p0', { at: at(1, 23) })];
    expect(pace(set, 1, late, new Date(2025, 0, 1, 23, 59).getTime()).doneToday).toBe(1);
    expect(pace(set, 1, late, new Date(2025, 0, 2, 0, 1).getTime()).doneToday).toBe(0);
  });
  it('is overdue after the last target day and done when everything is played', () => {
    expect(pace(set, 1, play(10, 1), at(30)).state).toBe('overdue');
    const small = makeSet(3, { cycles: [{ n: 1, startedAt: at(1), finishedAt: null, targetDays: 1 }] });
    expect(pace(small, 1, small.items.map((p) => att(p.id)), at(5)).state).toBe('done');
  });
  it('caps the expectation at the total and survives a clock before the start', () => {
    const small = makeSet(3, { cycles: [{ n: 1, startedAt: at(1), finishedAt: null, targetDays: 2 }] });
    expect(pace(small, 1, [], at(2)).expectedDone).toBe(3);
    expect(pace(set, 1, [], at(1) - 5 * 86_400_000).dayIndex).toBe(1);
    expect(pace(set, 9, [], at(1)).targetDays).toBe(1);
  });
});

describe('cycles', () => {
  it('start the next cycle only when the current one is finished, with the halved target', () => {
    const s = makeSet(3, { cycles: [{ n: 1, startedAt: 1, finishedAt: null, targetDays: 28 }] });
    expect(canStartNext(s)).toBe(false);
    expect(startNextCycle(s, 5)).toBe(s);
    const done = { ...s, cycles: [{ ...s.cycles[0], finishedAt: 9 }] };
    expect(canStartNext(done)).toBe(true);
    const next = startNextCycle(done, 50);
    expect(next.cycles).toHaveLength(2);
    expect(next.cycles[1]).toEqual({ n: 2, startedAt: 50, finishedAt: null, targetDays: 14 });
    expect(done.cycles).toHaveLength(1);
    const third = startNextCycle({ ...next, cycles: [next.cycles[0], { ...next.cycles[1], finishedAt: 60 }] }, 70);
    expect(third.cycles[2].targetDays).toBe(7);
    expect(canStartNext({ cycles: [] })).toBe(false);
  });
  it('picks the newest set with an unfinished cycle', () => {
    const open = (createdAt: number, id: string) => ({ id, createdAt, cycles: [{ n: 1, startedAt: 1, finishedAt: null, targetDays: 1 }] });
    const closed = (createdAt: number, id: string) => ({ id, createdAt, cycles: [{ n: 1, startedAt: 1, finishedAt: 2, targetDays: 1 }] });
    expect(pickActive([open(1, 'a'), closed(3, 'b'), open(2, 'c')])?.id).toBe('c');
    expect(pickActive([closed(1, 'a')])).toBeNull();
    expect(pickActive([])).toBeNull();
  });
  it('summaries list every cycle with days taken', () => {
    const s = makeSet(2, {
      cycles: [
        { n: 1, startedAt: at(1), finishedAt: at(3), targetDays: 4 },
        { n: 2, startedAt: at(5), finishedAt: null, targetDays: 2 },
      ],
    });
    const rows = cycleSummaries(s, [att('p0'), att('p1', { solved: false }), att('p0', { cycle: 2, timeMs: 2000 })]);
    expect(rows[0]).toMatchObject({ n: 1, targetDays: 4, days: 3, accuracy: 0.5, finished: true, done: 2 });
    expect(rows[1]).toMatchObject({ n: 2, days: null, accuracy: 1, medianMs: 2000, totalMs: 2000, finished: false });
  });
  it('compares two cycles', () => {
    expect(compareCycles({ accuracy: 0.8, medianMs: 6000 }, { accuracy: 0.9, medianMs: 4000 })).toEqual({ accuracyPoints: 10, medianMs: -2000 });
    expect(compareCycles({ accuracy: null, medianMs: null }, { accuracy: 0.9, medianMs: 4000 })).toEqual({ accuracyPoints: null, medianMs: null });
  });
});

describe('planRecord', () => {
  const set = makeSet(2);
  it('writes a new first attempt and says when it finishes the cycle', () => {
    expect(planRecord(set, 1, [], 'p0')).toEqual({ write: true, finishes: false });
    expect(planRecord(set, 1, [att('p0')], 'p1')).toEqual({ write: true, finishes: true });
  });
  it('writes nothing for a second attempt, an unknown puzzle or a closed cycle', () => {
    expect(planRecord(set, 1, [att('p0')], 'p0').write).toBe(false);
    expect(planRecord(set, 1, [], 'nope').write).toBe(false);
    expect(planRecord(set, 2, [], 'p0').write).toBe(false);
    const closed = { ...set, cycles: [{ ...set.cycles[0], finishedAt: 5 }] };
    expect(planRecord(closed, 1, [], 'p0').write).toBe(false);
  });
});

describe('canRecord', () => {
  const set = makeSet(2);
  it('is false for a closed cycle, a missing cycle or an unknown puzzle', () => {
    expect(canRecord(set, 1, 'p0')).toBe(true);
    expect(canRecord(set, 2, 'p0')).toBe(false);
    expect(canRecord(set, 1, 'nope')).toBe(false);
    expect(canRecord({ ...set, cycles: [{ ...set.cycles[0], finishedAt: 5 }] }, 1, 'p0')).toBe(false);
  });
});

describe('first days field', () => {
  it('an empty field is the default, not one day', () => {
    expect(clampFirstDays('')).toBe(28);
    expect(clampFirstDays('  ')).toBe(28);
    expect(clampFirstDays(null)).toBe(28);
    expect(clampFirstDays('0')).toBe(1);
  });
});

describe('text', () => {
  it('formats times', () => {
    expect(formatMs(null)).toBe('-');
    expect(formatMs(3200)).toBe('3.2 s');
    expect(formatMs(25_000)).toBe('25 s');
    expect(formatMs(65_000)).toBe('1 min 05 s');
    expect(formatMs(59_600)).toBe('1 min 00 s');
    expect(formatMs(119_600)).toBe('2 min 00 s');
    expect(formatTotal(59_600)).toBe('1 min');
    expect(formatTotal(30_000)).toBe('30 s');
    expect(formatTotal(25 * 60_000)).toBe('25 min');
    expect(formatTotal(75 * 60_000)).toBe('1 h 15 min');
  });
});
