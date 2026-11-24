import { describe, expect, it } from 'vitest';
import type { AnalysedMove, GameReport } from '@knightfall/core';
import type { SelfReview } from '../../../shared/db.ts';
import {
  buildSkipped, buildSubmitted, canMark, cleanLesson, cleanSelfReviewRow, compare, compareText, enginePoint, isSlowGame, MAX_LESSON, needsSelfReview, REASONS,
  selfReviewResult, submitProblem,
} from './selfReviewLogic.ts';

const row = (over: Partial<SelfReview> = {}): SelfReview => ({ gameKey: 'g', at: 1, side: 'w', turningPly: 4, reason: 'plan', lesson: 'Look first', skipped: false, ...over });

describe('needsSelfReview', () => {
  const base = { mode: 'all' as const, game: { source: 'lichess' as const, speed: 'blitz' }, side: 'w' as const, hasAnalysis: false, review: undefined };
  it('is false when off, when the side is unknown, when analysed or when a row exists', () => {
    expect(needsSelfReview(base)).toBe(true);
    expect(needsSelfReview({ ...base, mode: 'off' })).toBe(false);
    expect(needsSelfReview({ ...base, side: null })).toBe(false);
    expect(needsSelfReview({ ...base, hasAnalysis: true })).toBe(false);
    expect(needsSelfReview({ ...base, review: row() })).toBe(false);
    expect(needsSelfReview({ ...base, review: row({ skipped: true }) })).toBe(false);
    expect(needsSelfReview({ ...base, review: null })).toBe(true);
  });
  it("'slow' means bot games and rapid, daily, classical or correspondence (any case)", () => {
    const slow = { ...base, mode: 'slow' as const };
    expect(needsSelfReview(slow)).toBe(false);
    expect(needsSelfReview({ ...slow, game: { source: 'lichess', speed: 'Rapid' } })).toBe(true);
    expect(needsSelfReview({ ...slow, game: { source: 'chesscom', speed: 'daily' } })).toBe(true);
    expect(needsSelfReview({ ...slow, game: { source: 'lichess', speed: 'CLASSICAL' } })).toBe(true);
    expect(needsSelfReview({ ...slow, game: { source: 'lichess', speed: 'correspondence' } })).toBe(true);
    expect(needsSelfReview({ ...slow, game: { source: 'bot' } })).toBe(true);
    expect(needsSelfReview({ ...slow, game: { source: 'pgn' } })).toBe(false);
    expect(isSlowGame({ source: 'chesscom', speed: 'bullet' })).toBe(false);
  });
});

function mv(ply: number, cls: AnalysedMove['class']): AnalysedMove {
  const color = ply % 2 === 0 ? 'w' : 'b';
  return { ply, color, moveNumber: Math.floor(ply / 2) + 1, san: `m${ply}`, class: cls } as AnalysedMove;
}
const report = (classes: AnalysedMove['class'][]) => ({ moves: classes.map((c, i) => mv(i, c)) }) as unknown as GameReport;

describe('enginePoint', () => {
  it('is the first mistake, miss or blunder of that side', () => {
    const r = report(['best', 'blunder', 'good', 'inaccuracy', 'miss', 'mistake']);
    expect(enginePoint(r, 'w')).toBe(4);
    expect(enginePoint(r, 'b')).toBe(1);
  });
  it('is null when that side has none (inaccuracies do not count)', () => {
    expect(enginePoint(report(['best', 'inaccuracy', 'good', 'blunder']), 'w')).toBeNull();
  });
});

describe('compare', () => {
  it('classifies the distance', () => {
    expect(compare(10, 10)).toBe('exact');
    expect(compare(10, 12)).toBe('close');
    expect(compare(10, 14)).toBe('close');
    expect(compare(14, 10)).toBe('close');
    expect(compare(10, 16)).toBe('earlier');
    expect(compare(16, 10)).toBe('later');
    expect(compare(0, 5)).toBe('earlier');
  });
  it('handles none on either side', () => {
    expect(compare(6, null)).toBe('engine-none');
    expect(compare(null, 6)).toBe('missed');
    expect(compare(null, null)).toBe('both-none');
  });
  it('has a sentence for each outcome, with the moves in it', () => {
    expect(compareText('exact', '12. Nf3', '12. Nf3')).toContain('12. Nf3');
    expect(compareText('earlier', '5. e4', '12. Nf3')).toMatch(/5\. e4.*12\. Nf3/);
    expect(compareText('later', '12. Nf3', '5. e4')).toMatch(/5\. e4.*12\. Nf3/);
    expect(compareText('missed', null, '12. Nf3')).toContain('12. Nf3');
    expect(compareText('engine-none', '3. d4', null)).toContain('3. d4');
    for (const k of ['exact', 'close', 'earlier', 'later', 'engine-none', 'missed', 'both-none'] as const) {
      const t = compareText(k, '1. e4', '2. d4');
      expect(t).not.toContain('—');
      expect(t.endsWith('.')).toBe(true);
    }
  });
  it('selfReviewResult uses the row side and move labels', () => {
    const r = report(['best', 'best', 'blunder', 'good']);
    const res = selfReviewResult({ side: 'w', turningPly: 0 }, r);
    expect(res.enginePly).toBe(2);
    expect(res.kind).toBe('close');
    expect(res.engineLabel).toBe('2. m2');
    expect(res.mineLabel).toBe('1. m0');
    expect(selfReviewResult({ side: 'b', turningPly: null }, r).kind).toBe('both-none');
  });
});

describe('canMark', () => {
  const moves = [mv(0, 'good'), mv(1, 'good'), mv(2, 'good')];
  it('allows only the own side and valid indexes', () => {
    expect(canMark(moves, 0, 'w')).toBe(true);
    expect(canMark(moves, 1, 'w')).toBe(false);
    expect(canMark(moves, 1, 'b')).toBe(true);
    expect(canMark(moves, -1, 'w')).toBe(false);
    expect(canMark(moves, 3, 'w')).toBe(false);
    expect(canMark(moves, 0.5, 'w')).toBe(false);
  });
});

describe('lesson and submit', () => {
  it('cleanLesson collapses spaces and cuts to the limit', () => {
    expect(cleanLesson('  look   at\n checks ')).toBe('look at checks');
    expect(cleanLesson('x'.repeat(500))).toHaveLength(MAX_LESSON);
    expect(cleanLesson(42)).toBe('');
  });
  it('lists the eight reasons', () => {
    expect(REASONS.map((r) => r.id)).toEqual(['check', 'capture', 'threat', 'calculation', 'time', 'plan', 'opening', 'endgame']);
  });
  it('submitProblem names what is missing', () => {
    expect(submitProblem(null, null, 'abc')).toMatch(/Mark a move/);
    expect(submitProblem({ kind: 'move', ply: 2 }, null, 'abc')).toMatch(/reason/);
    expect(submitProblem({ kind: 'move', ply: 2 }, 'plan', ' a ')).toMatch(/lesson/);
    expect(submitProblem({ kind: 'none' }, null, 'abc')).toBeNull();
    expect(submitProblem({ kind: 'move', ply: 2 }, 'plan', 'abc')).toBeNull();
  });
  it('buildSubmitted drops the reason when no move is marked', () => {
    expect(buildSubmitted({ gameKey: 'g', side: 'b', choice: { kind: 'none' }, reason: 'plan', lesson: ' ok  then ', at: 5 })).toEqual({
      gameKey: 'g', at: 5, side: 'b', turningPly: null, reason: null, lesson: 'ok then', skipped: false,
    });
    expect(buildSubmitted({ gameKey: 'g', side: 'w', choice: { kind: 'move', ply: 6 }, reason: 'check', lesson: 'abc', at: 5 }).turningPly).toBe(6);
    expect(() => buildSubmitted({ gameKey: 'g', side: 'w', choice: null, reason: null, lesson: 'abc', at: 5 })).toThrow();
  });
  it('buildSkipped', () => {
    expect(buildSkipped({ gameKey: 'g', side: 'w', at: 9 })).toEqual({ gameKey: 'g', at: 9, side: 'w', turningPly: null, reason: null, lesson: '', skipped: true });
  });
});

describe('cleanSelfReviewRow', () => {
  it('keeps a good row and repairs soft damage', () => {
    expect(cleanSelfReviewRow(row(), 20)).toEqual(row());
    expect(cleanSelfReviewRow(row({ reason: 'bogus' as never, lesson: '  hi   there ' }), 20)).toMatchObject({ reason: null, lesson: 'hi there' });
  });
  it('rejects damaged rows', () => {
    expect(cleanSelfReviewRow(null, 20)).toBeNull();
    expect(cleanSelfReviewRow('x', 20)).toBeNull();
    expect(cleanSelfReviewRow(row({ side: 'x' as never }), 20)).toBeNull();
    expect(cleanSelfReviewRow(row({ turningPly: 20 }), 20)).toBeNull();
    expect(cleanSelfReviewRow(row({ turningPly: -1 }), 20)).toBeNull();
    expect(cleanSelfReviewRow(row({ turningPly: 1.5 }), 20)).toBeNull();
  });
  it('a skipped row has no point', () => {
    expect(cleanSelfReviewRow(row({ skipped: true, turningPly: 3 }), 20)?.turningPly).toBeNull();
  });
});
