import { describe, expect, it } from 'vitest';
import type { PositionEval } from '@knightfall/core';
import { judgeRetryMove, retryCanMove, retryFinished, retryHint, retryJudge, retryMessage, retryResume, retryStart } from './retryLogic.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const evalBefore = {
  fen: START,
  depth: 16,
  source: 'engine',
  score: { cp: 30 },
  lines: [
    { score: { cp: 30 }, pv: ['e2e4'] },
    { score: { cp: 28 }, pv: ['d2d4'] },
    { score: { cp: -200 }, pv: ['f2f3'] },
  ],
} as unknown as PositionEval;

describe('retry state machine', () => {
  it('starts waiting for a move', () => {
    const s = retryStart();
    expect(s).toEqual({ phase: 'ask', misses: 0 });
    expect(retryCanMove(s)).toBe(true);
    expect(retryHint(s)).toBe(false);
  });
  it('finishes on the best or a good move', () => {
    expect(retryFinished(retryJudge(retryStart(), 'best'))).toBe(true);
    expect(retryJudge(retryStart(), 'good').phase).toBe('good');
    expect(retryCanMove(retryJudge(retryStart(), 'best'))).toBe(false);
  });
  it('counts misses, resumes, and hints after two', () => {
    let s = retryJudge(retryStart(), 'wrong');
    expect(s).toEqual({ phase: 'wrong', misses: 1 });
    expect(retryCanMove(s)).toBe(false);
    s = retryResume(s);
    expect(s.phase).toBe('ask');
    expect(retryHint(s)).toBe(false);
    s = retryResume(retryJudge(s, 'wrong'));
    expect(s.misses).toBe(2);
    expect(retryHint(s)).toBe(true);
  });
  it('ignores a verdict while not waiting', () => {
    const done = retryJudge(retryStart(), 'best');
    expect(retryJudge(done, 'wrong')).toBe(done);
    expect(retryResume(done)).toBe(done);
  });
  it('words each state', () => {
    expect(retryMessage(retryJudge(retryStart(), 'best'), 'c3').title).toBe("That's it!");
    expect(retryMessage(retryJudge(retryStart(), 'good'), 'c3').title).toContain('stronger move');
    expect(retryMessage(retryJudge(retryStart(), 'wrong'), 'c3').title).toContain('try again');
    expect(retryMessage(retryStart(), 'c3').text).toContain('c3');
  });
  it('judges against the engine lines', () => {
    expect(judgeRetryMove(evalBefore, 'e2e4', 'w')).toBe('best');
    expect(judgeRetryMove(evalBefore, 'd2d4', 'w')).toBe('good');
    expect(judgeRetryMove(evalBefore, 'f2f3', 'w')).toBe('wrong');
    expect(judgeRetryMove(evalBefore, 'a2a3', 'w')).toBe('wrong');
    expect(judgeRetryMove(undefined, 'e2e4', 'w')).toBe('wrong');
  });
});
