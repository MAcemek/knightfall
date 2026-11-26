import { describe, expect, it } from 'vitest';
import type { PositionEval } from '@knightfall/core';
import { refineConsistently } from './analyseGame.ts';
import { extraPositionCap, harmfulBoundaries, harmfulBoundaryMoves, MAX_EXTRA_POSITIONS, MOBILE_MAX_EXTRA_POSITIONS, refinedPositions } from './keyMoments.ts';
import { isAbortError, type EvalJob } from './pool.ts';

const BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
/** White moves at even indexes, Black at odd ones. */
const fenAt = (i: number) => `${BOARD} ${i % 2 ? 'b' : 'w'} KQkq - 0 ${i}`;
const ev = (i: number, cp: number, depth = 18): PositionEval => ({ fen: fenAt(i), depth, source: 'engine', lines: [{ score: { cp }, pv: ['e2e4'] }], score: { cp } });
const make = (n: number) => Array.from({ length: n }, (_, i) => fenAt(i));
const flat = (n: number) => make(n).map((_, i) => ev(i, -90));
/** What a depth-24 search says: White-view +400 on even positions, -400 on odd ones (every deep move is a big swing). */
const deepCp = (i: number) => (i % 2 ? -400 : 400);
const deepAll = (j: EvalJob, fens: string[]) => ev(fens.indexOf(j.fen), deepCp(fens.indexOf(j.fen)), 24);

describe('harmfulBoundaries', () => {
  const fens = make(8);
  it('finds the black reply that is judged deep-vs-shallow (the reported scenario)', () => {
    const first = flat(8);
    const merged = first.slice();
    merged[4] = ev(4, -400, 24);
    merged[5] = ev(5, -400, 24);
    const refined = refinedPositions(first, merged);
    expect([...refined].sort()).toEqual([4, 5]);
    // Black's move at ply 5: -400 (deep) to -90 (shallow) reads as a miss; with first-pass numbers it was nothing.
    expect(harmfulBoundaries(fens, first, merged, refined)).toEqual([6]);
  });

  it('leaves a boundary that did not get worse alone', () => {
    const first = flat(8);
    const merged = first.slice();
    merged[4] = ev(4, -90, 24);
    merged[5] = ev(5, -90, 24);
    expect(harmfulBoundaries(fens, first, merged, refinedPositions(first, merged))).toEqual([]);
  });

  it('ignores a boundary whose loss was already there in the first pass', () => {
    const first = flat(8);
    first[5] = ev(5, -400);
    const merged = first.slice();
    merged[5] = ev(5, -400, 24);
    expect(harmfulBoundaries(fens, first, merged, refinedPositions(first, merged))).toEqual([]);
  });

  it('never lists a finished position', () => {
    const first = flat(8);
    first[6] = { ...ev(6, -90), terminal: 'draw' as const };
    const merged = first.slice();
    merged[4] = ev(4, -400, 24);
    merged[5] = ev(5, -400, 24);
    expect(harmfulBoundaryMoves(fens, first, merged, refinedPositions(first, merged))).toEqual([]);
  });

  it('caps by device', () => {
    expect(extraPositionCap(false)).toBe(MAX_EXTRA_POSITIONS);
    expect(extraPositionCap(true)).toBe(MOBILE_MAX_EXTRA_POSITIONS);
    expect(MAX_EXTRA_POSITIONS).toBe(12);
    expect(MOBILE_MAX_EXTRA_POSITIONS).toBe(8);
  });
});

describe('refineConsistently', () => {
  it('searches the shallow side of the harmful move so it is no longer deep-vs-shallow', async () => {
    const fens = make(8);
    const first = flat(8);
    const jobs: string[] = [];
    const out = await refineConsistently({
      fens, evals: first, plies: [4, 5], depth: 24, maxExtra: 0,
      evaluate: async (j) => (jobs.push(j.fen), ev(fens.indexOf(j.fen), -400, 24)),
    });
    expect(jobs.sort()).toEqual([fens[4], fens[5]].sort()); // no extra budget: no extra search
    // The move at ply 5 is now judged at one depth: the deep side went back to the first pass.
    expect(out[5]).toBe(first[5]);
    expect(out[4].depth).toBe(24);
    expect(harmfulBoundaryMoves(fens, first, out, refinedPositions(first, out))).toEqual([]);

    const jobs2: string[] = [];
    const out2 = await refineConsistently({
      fens, evals: first, plies: [4, 5], depth: 24,
      evaluate: async (j) => (jobs2.push(j.fen), ev(fens.indexOf(j.fen), -400, 24)),
    });
    expect(jobs2).toContain(fens[6]);
    expect(out2[6].depth).toBe(24);
    expect(out2[5].depth).toBe(24);
  });

  it('does not search anything extra when no boundary is harmful', async () => {
    const fens = make(8);
    const first = flat(8);
    const jobs: string[] = [];
    await refineConsistently({ fens, evals: first, plies: [3, 4], depth: 24, evaluate: async (j) => (jobs.push(j.fen), ev(fens.indexOf(j.fen), -90, 24)) });
    expect(jobs.sort()).toEqual([fens[3], fens[4]].sort());
  });

  it('stops after three extra rounds and leaves every move at one depth', async () => {
    const fens = make(12);
    const first = flat(12);
    const jobs: string[] = [];
    const out = await refineConsistently({ fens, evals: first, plies: [0, 1], depth: 24, evaluate: async (j) => (jobs.push(j.fen), deepAll(j, fens)) });
    expect(jobs.sort()).toEqual([0, 1, 2, 3, 4].map((i) => fens[i]).sort());
    expect(harmfulBoundaryMoves(fens, first, out, refinedPositions(first, out))).toEqual([]);
    out.forEach((e, i) => expect(e === first[i] || e.depth === 24).toBe(true));
  });

  it('stops when the extra-position budget is used up', async () => {
    const fens = make(12);
    const first = flat(12);
    const jobs: string[] = [];
    await refineConsistently({ fens, evals: first, plies: [0, 1], depth: 24, maxExtra: 2, evaluate: async (j) => (jobs.push(j.fen), deepAll(j, fens)) });
    expect(jobs.sort()).toEqual([0, 1, 2, 3].map((i) => fens[i]).sort());
  });

  it('grows the progress total with the extra positions', async () => {
    const fens = make(8);
    const seen: [number, number][] = [];
    await refineConsistently({
      fens, evals: flat(8), plies: [4, 5], depth: 24,
      evaluate: async (j) => ev(fens.indexOf(j.fen), -400, 24),
      onEval: (_i, _e, done, total) => seen.push([done, total]),
    });
    expect(seen.slice(0, 2).map((s) => s[1])).toEqual([2, 2]);
    expect(seen[2]).toEqual([3, 3]);
  });

  it('rejects with AbortError when aborted during an extra round', async () => {
    const fens = make(8);
    const ctl = new AbortController();
    const p = refineConsistently({
      fens, evals: flat(8), plies: [4, 5], depth: 24, signal: ctl.signal,
      evaluate: (j) =>
        j.fen === fens[6]
          ? new Promise((_res, rej) => {
              j.signal?.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
              ctl.abort();
            })
          : Promise.resolve(ev(fens.indexOf(j.fen), -400, 24)),
    });
    await expect(p).rejects.toSatisfy(isAbortError);
  });

  it('never replaces an evaluation by a shallower one outside the documented revert', async () => {
    const fens = make(8);
    const first = flat(8);
    first[2] = ev(2, -90, 40); // already deeper than the second pass
    const out = await refineConsistently({ fens, evals: first, plies: [2, 3], depth: 24, evaluate: async (j) => ev(fens.indexOf(j.fen), -90, 24) });
    out.forEach((e, i) => expect(e.depth).toBeGreaterThanOrEqual(first[i].depth));
  });
});
