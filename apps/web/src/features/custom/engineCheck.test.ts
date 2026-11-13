import { describe, expect, it } from 'vitest';
import type { EngineLine, EvalScore, PositionEval } from '@knightfall/core';
import type { EvalJob } from '../../shared/engine/index.ts';
import { checkSolution, judgeSolverMove, summarise, type MoveCheck } from './engineCheck.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
/** Back-rank mate in one: Ra8#. */
const MATE_IN_1 = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';

const line = (score: EvalScore, first: string): EngineLine => ({ score, pv: [first] });
const ev = (fen: string, ...lines: EngineLine[]): PositionEval => ({ fen, depth: 14, source: 'engine', lines, score: lines[0].score });

describe('judgeSolverMove', () => {
  it('unique: best move with a clear margin', () => {
    expect(judgeSolverMove(ev(START, line({ cp: 400 }, 'e2e4'), line({ cp: 50 }, 'd2d4')), 'e2e4', 0)).toEqual({ ply: 0, san: 'e4', verdict: 'unique', gapCp: 350 });
  });
  it('alternative: the second line is within 150 cp', () => {
    expect(judgeSolverMove(ev(START, line({ cp: 400 }, 'e2e4'), line({ cp: 300 }, 'd2d4')), 'e2e4', 0)).toEqual({ ply: 0, san: 'e4', verdict: 'alternative', other: 'd4', gapCp: 100 });
    expect(judgeSolverMove(ev(START, line({ cp: 400 }, 'e2e4'), line({ cp: 300 }, 'd2d4')), 'd2d4', 0)).toMatchObject({ verdict: 'alternative', other: 'e4' });
  });
  it('weaker: the engine clearly prefers another move', () => {
    expect(judgeSolverMove(ev(START, line({ cp: 400 }, 'e2e4'), line({ cp: 0 }, 'd2d4')), 'd2d4', 2)).toEqual({ ply: 2, san: 'd4', verdict: 'weaker', other: 'e4', gapCp: 400 });
    expect(judgeSolverMove(ev(START, line({ cp: 400 }, 'e2e4'), line({ cp: 390 }, 'd2d4')), 'g1f3', 0)).toMatchObject({ verdict: 'weaker', other: 'e4' });
  });
  it('measures the gap from Black\'s side when Black moves', () => {
    const before = ev(AFTER_E4, line({ cp: -400 }, 'e7e5'), line({ cp: -50 }, 'c7c5'));
    expect(judgeSolverMove(before, 'e7e5', 1)).toMatchObject({ verdict: 'unique', gapCp: 350 });
  });
  it('a forced mate against a merely winning line is unique; two mates are alternatives', () => {
    expect(judgeSolverMove(ev(START, line({ mate: 3 }, 'e2e4'), line({ cp: 950 }, 'd2d4')), 'e2e4', 0)).toMatchObject({ verdict: 'unique' });
    expect(judgeSolverMove(ev(START, line({ mate: 2 }, 'e2e4'), line({ mate: 4 }, 'd2d4')), 'e2e4', 0)).toMatchObject({ verdict: 'alternative', other: 'd4' });
  });
  it('trivial when the engine has a single line', () => {
    expect(judgeSolverMove(ev(START, line({ cp: 10 }, 'e2e4')), 'e2e4', 0)).toEqual({ ply: 0, san: 'e4', verdict: 'trivial' });
  });
});

describe('checkSolution', () => {
  it('checks only solver moves, in order, with MultiPV 2', async () => {
    const jobs: EvalJob[] = [];
    const seen: [number, number][] = [];
    const checks = await checkSolution({
      fen: START,
      moves: ['e2e4', 'e7e5', 'g1f3'],
      opponentFirst: false,
      evaluate: async (job) => {
        jobs.push(job);
        const first = job.fen === START ? 'e2e4' : 'g1f3';
        return ev(job.fen, line({ cp: 500 }, first), line({ cp: 0 }, 'a2a3'));
      },
      onResult: (_c, done, total) => seen.push([done, total]),
    });
    expect(checks.map((c) => [c.ply, c.san, c.verdict])).toEqual([[0, 'e4', 'unique'], [2, 'Nf3', 'unique']]);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ fen: START, depth: 14, multiPv: 2 });
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });
  it('skips the opponent\'s setup move', async () => {
    const fens: string[] = [];
    await checkSolution({
      fen: START,
      moves: ['e2e4', 'e7e5'],
      opponentFirst: true,
      evaluate: async (job) => (fens.push(job.fen), ev(job.fen, line({ cp: -10 }, 'e7e5'), line({ cp: 300 }, 'a7a6'))),
    });
    expect(fens).toEqual([AFTER_E4]);
  });
  it('does not ask the engine about a mating move', async () => {
    let calls = 0;
    const checks = await checkSolution({ fen: MATE_IN_1, moves: ['a1a8'], opponentFirst: false, evaluate: async (job) => (calls++, ev(job.fen, line({ cp: 0 }, 'a1a8'))) });
    expect(calls).toBe(0);
    expect(checks).toEqual([{ ply: 0, san: 'Ra8#', verdict: 'trivial' }]);
  });
  it('propagates engine errors', async () => {
    await expect(checkSolution({ fen: START, moves: ['e2e4'], opponentFirst: false, evaluate: async () => Promise.reject(new Error('no engine')) })).rejects.toThrow('no engine');
  });
});

describe('summarise', () => {
  const c = (verdict: MoveCheck['verdict']): MoveCheck => ({ ply: 0, san: 'e4', verdict });
  it('reports the worst finding', () => {
    expect(summarise([c('unique'), c('trivial')])).toEqual({ tone: 'good', text: 'Every solver move is the clear best move.' });
    expect(summarise([c('unique'), c('alternative')])).toMatchObject({ tone: 'warn' });
    expect(summarise([c('alternative'), c('weaker'), c('weaker')])).toEqual({ tone: 'bad', text: "2 solver moves are not the engine's best move." });
    expect(summarise([])).toMatchObject({ tone: 'good' });
  });
});
