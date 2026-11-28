import { describe, expect, it } from 'vitest';
import type { PositionEval } from '@knightfall/core';
import { explainWrong } from './whyLogic.ts';

// White to move; Nf3 is legal. After Nf3 it is Black to move.
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_NF3 = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1';

function ev(score: PositionEval['score'], pv: string[], terminal?: PositionEval['terminal']): PositionEval {
  return { fen: AFTER_NF3, depth: 14, source: 'engine', lines: pv.length ? [{ score, pv }] : [], score, terminal };
}

describe('explainWrong', () => {
  it('says the opponent is winning, with the white-POV score', () => {
    const r = explainWrong(START, 'g1f3', ev({ cp: -410 }, ['e7e5']));
    expect(r.moveSan).toBe('Nf3');
    expect(r.fenAfter).toBe(AFTER_NF3);
    expect(r.reply).toEqual({ uci: 'e7e5', san: 'e5' });
    expect(r.text).toBe('After Nf3, Black answers e5 and is winning (−4.1).');
  });

  it('says the opponent is better for a smaller edge', () => {
    expect(explainWrong(START, 'g1f3', ev({ cp: -90 }, ['e7e5'])).text).toBe('After Nf3, Black answers e5 and is better (−0.9).');
  });

  it('names a forced mate against the solver', () => {
    const r = explainWrong(START, 'g1f3', ev({ mate: -3 }, ['g8f6']));
    expect(r.text).toBe('After Nf3, Black answers Nf6 and mates in 3.');
  });

  it('flips the point of view when Black played the wrong move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1';
    const after = 'r1bqkbnr/pppppppp/2n5/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2';
    const e: PositionEval = { fen: after, depth: 14, source: 'engine', lines: [{ score: { cp: 350 }, pv: ['f3e5'] }], score: { cp: 350 } };
    expect(explainWrong(fen, 'b8c6', e).text).toBe('After Nc6, White answers Ne5 and is winning (+3.5).');
  });

  it('says the solver is still better when the move is only second best', () => {
    const r = explainWrong(START, 'g1f3', ev({ cp: 120 }, ['e7e5']));
    expect(r.text).toBe("After Nf3, White is still better (+1.2), but the puzzle's move wins more.");
  });

  it('handles a level position', () => {
    const r = explainWrong(START, 'g1f3', ev({ cp: 10 }, ['e7e5']));
    expect(r.text).toContain('about level');
  });

  it('handles no reply and stalemate', () => {
    expect(explainWrong(START, 'g1f3', ev({ cp: 0 }, [], 'stalemate')).text).toBe('Nf3 allows stalemate.');
    const none = explainWrong(START, 'g1f3', ev({ cp: 150 }, []));
    expect(none.reply).toBeUndefined();
    expect(none.text).toContain('still better');
  });

  it('throws on an illegal move', () => {
    expect(() => explainWrong(START, 'e2e5', ev({ cp: 0 }, []))).toThrow();
  });
});
