import { describe, expect, it } from 'vitest';
import { ingestAttempts, type MissAttempt } from '../../shared/progress/srs.ts';

describe('Woodpecker and the review queue', () => {
  it('a missed woodpecker attempt changes nothing', () => {
    const miss: MissAttempt = { id: 1, puzzleId: 'p1', puzzleRating: 1300, solved: false, mode: 'woodpecker', at: 1_700_000_000_000 };
    expect(ingestAttempts(new Map(), [miss, { ...miss, id: 2 }])).toEqual([]);
  });
  it('still queues a rated miss in the same batch', () => {
    const base: MissAttempt = { id: 1, puzzleId: 'p1', puzzleRating: 1300, solved: false, mode: 'woodpecker', at: 1_700_000_000_000 };
    const out = ingestAttempts(new Map(), [base, { ...base, id: 2, puzzleId: 'p2', mode: 'rated' }]);
    expect(out.map((r) => r.puzzleId)).toEqual(['p2']);
  });
});
