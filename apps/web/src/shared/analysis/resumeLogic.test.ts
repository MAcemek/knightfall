import { describe, expect, it } from 'vitest';
import type { GameReport, PositionEval } from '@knightfall/core';
import { countEvals, interruptedPatch, knownFromPartial, type DoneView } from './resumeLogic.ts';

const ev = (fen: string): PositionEval => ({ fen, depth: 16, source: 'engine', lines: [], score: { cp: 0 } });

describe('knownFromPartial', () => {
  const partial = { engine: 'lite', depth: 16, evals: [ev('a'), undefined, ev('c')] };
  it('reuses finished evaluations for the same engine, depth and length', () => {
    const known = knownFromPartial(partial, 'lite', 16, 3);
    expect(known).toEqual(partial.evals);
    expect(known).not.toBe(partial.evals);
  });
  it('starts over when the engine, depth or game length differs, or nothing finished', () => {
    expect(knownFromPartial(partial, 'full', 16, 3)).toBeUndefined();
    expect(knownFromPartial(partial, 'lite', 20, 3)).toBeUndefined();
    expect(knownFromPartial(partial, 'lite', 16, 4)).toBeUndefined();
    expect(knownFromPartial(null, 'lite', 16, 3)).toBeUndefined();
    expect(knownFromPartial({ ...partial, evals: [undefined, undefined, undefined] }, 'lite', 16, 3)).toBeUndefined();
  });
  it('counts finished slots', () => {
    expect(countEvals(partial.evals)).toBe(2);
  });
});

describe('interruptedPatch', () => {
  const previous: DoneView<'lite'> = { report: { version: 1 } as unknown as GameReport, evals: [ev('a'), ev('b')], engine: 'lite', depth: 16, analysedAt: 5, staleEngine: true };
  it('restores the previous analysis as done', () => {
    expect(interruptedPatch(previous, 'Analysis stopped.')).toEqual({ status: 'done', error: null, report: previous.report, evals: previous.evals, done: 2, total: 2, engine: 'lite', depth: 16, analysedAt: 5, staleEngine: true });
  });
  it('shows the error when there was no previous analysis', () => {
    expect(interruptedPatch(null, 'Analysis stopped.')).toEqual({ status: 'error', error: 'Analysis stopped.' });
  });
});
