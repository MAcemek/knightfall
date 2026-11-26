import { describe, expect, it } from 'vitest';
import type { PositionEval } from '@knightfall/core';
import { refineKeyMoments } from './analyseGame.ts';
import { EnginePool, isAbortError, type EvalJob } from './pool.ts';
import type { AnalyseOptions, PoolEngine } from './uci.ts';

const BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const fenAt = (i: number) => `${BOARD} ${i % 2 ? 'b' : 'w'} KQkq - 0 ${i}`;
const ev = (i: number, depth: number, cp = 10, source: 'engine' | 'cloud' = 'engine'): PositionEval => ({ fen: fenAt(i), depth, source, lines: [{ score: { cp }, pv: ['e2e4'] }], score: { cp } });
const fens = Array.from({ length: 8 }, (_, i) => fenAt(i));
const first = fens.map((_, i) => ev(i, 18));

describe('refineKeyMoments', () => {
  it('searches only the chosen positions, at the second-pass depth, with two lines and a clean hash', async () => {
    const jobs: EvalJob[] = [];
    const out = await refineKeyMoments({
      fens, evals: first, plies: [5, 2, 3], depth: 24,
      evaluate: async (j) => (jobs.push(j), ev(fens.indexOf(j.fen), 24, 99)),
    });
    expect(jobs.map((j) => j.fen).sort()).toEqual([fens[2], fens[3], fens[5]].sort());
    expect(jobs.every((j) => j.depth === 24 && j.multiPv === 2 && j.fresh === true)).toBe(true);
    for (const i of [0, 1, 4, 6, 7]) expect(out[i]).toBe(first[i]);
    for (const i of [2, 3, 5]) expect(out[i].depth).toBe(24);
    expect(first[2].depth).toBe(18);
  });

  it('asks in the order given (highest loss first)', async () => {
    const jobs: EvalJob[] = [];
    await refineKeyMoments({ fens, evals: first, plies: [6, 1, 4], depth: 24, evaluate: async (j) => (jobs.push(j), ev(fens.indexOf(j.fen), 24)) });
    const byPriority = [...jobs].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).map((j) => j.fen);
    expect(byPriority).toEqual([fens[6], fens[1], fens[4]]);
  });

  it('skips positions that are already deep enough and never swaps in a shallower result', async () => {
    const evals = first.slice();
    evals[2] = ev(2, 40, 5, 'cloud');
    evals[3] = ev(3, 18, 7);
    const jobs: string[] = [];
    const out = await refineKeyMoments({
      fens, evals, plies: [2, 3], depth: 24,
      evaluate: async (j) => (jobs.push(j.fen), ev(3, 17, 999)), // the engine came back shallower than the stored one
    });
    expect(jobs).toEqual([fens[3]]);
    expect(out[2]).toBe(evals[2]);
    expect(out[3]).toBe(evals[3]);
  });

  it('reports progress per finished position', async () => {
    const seen: [number, number, number][] = [];
    await refineKeyMoments({
      fens, evals: first, plies: [1, 2, 3], depth: 24,
      evaluate: async (j) => ev(fens.indexOf(j.fen), 24),
      onEval: (i, _e, done, total) => seen.push([i, done, total]),
    });
    expect(seen.map((s) => s[1])).toEqual([1, 2, 3]);
    expect(seen.every((s) => s[2] === 3)).toBe(true);
  });

  it('returns a copy without any search when nothing needs a second look', async () => {
    let calls = 0;
    const out = await refineKeyMoments({ fens, evals: first, plies: [], depth: 24, evaluate: async () => (calls++, ev(0, 24)) });
    expect(calls).toBe(0);
    expect(out).toEqual(first);
    expect(out).not.toBe(first);
  });

  it('rejects with AbortError when aborted, before or during the pass', async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(refineKeyMoments({ fens, evals: first, plies: [1], depth: 24, evaluate: async () => ev(1, 24), signal: pre.signal })).rejects.toSatisfy(isAbortError);

    const ctl = new AbortController();
    const p = refineKeyMoments({
      fens, evals: first, plies: [1, 2], depth: 24, signal: ctl.signal,
      evaluate: (j) => new Promise((_res, rej) => j.signal?.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' })))),
    });
    ctl.abort();
    await expect(p).rejects.toSatisfy(isAbortError);
  });

  it('stops the other searches when one fails', async () => {
    const signals: AbortSignal[] = [];
    const p = refineKeyMoments({
      fens, evals: first, plies: [1, 2, 3], depth: 24,
      evaluate: (j) => {
        signals.push(j.signal!);
        return j.fen === fens[1] ? Promise.reject(new Error('engine crashed')) : new Promise(() => {});
      },
    });
    await expect(p).rejects.toThrow('engine crashed');
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('never runs more searches at once than the pool has engines', async () => {
    let running = 0;
    let peak = 0;
    let created = 0;
    class Fake implements PoolEngine {
      constructor() {
        created++;
      }
      async analyse(fen: string, opts: AnalyseOptions): Promise<PositionEval> {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 2));
        running--;
        return ev(fens.indexOf(fen), opts.depth);
      }
      stop() {}
      terminate() {}
    }
    const pool = new EnginePool({ size: 2, create: () => new Fake() });
    const out = await refineKeyMoments({ fens, evals: first, plies: [0, 1, 2, 3, 4, 5, 6, 7], depth: 24, evaluate: (j) => pool.evaluate(j) });
    pool.dispose();
    expect(out.every((e) => e.depth === 24)).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(created).toBeLessThanOrEqual(2);
  });
});
