import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '../db.ts';
import { dueReviews, formatInterval, gradeReview, ingestAttempts, lapseReview, newReview, REVIEW_INTERVALS_MS, REVIEW_MAX_BOX, reviewSummary, type MissAttempt } from './srs.ts';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({ ...newReview({ puzzleId: 'p1', puzzleRating: 1200 }, NOW), ...over });

describe('newReview / lapseReview', () => {
  it('starts in box 0, due in 10 minutes', () => {
    const r = newReview({ puzzleId: 'p1', puzzleRating: 1500, themes: ['fork'] }, NOW);
    expect(r).toMatchObject({ puzzleId: 'p1', puzzleRating: 1500, themes: ['fork'], box: 0, lapses: 0, reps: 0, lastAt: null, addedAt: NOW });
    expect(r.due).toBe(NOW + REVIEW_INTERVALS_MS[0]);
  });
  it('a lapse resets the box and counts', () => {
    const r = lapseReview(item({ box: 3, lapses: 1 }), NOW + 5);
    expect(r).toMatchObject({ box: 0, lapses: 2, due: NOW + 5 + REVIEW_INTERVALS_MS[0] });
  });
});

describe('gradeReview', () => {
  it('clean solve moves up one box with that box interval', () => {
    const r = gradeReview(item({ box: 1 }), { solved: true, clean: true }, NOW)!;
    expect(r).toMatchObject({ box: 2, reps: 1, lastAt: NOW, due: NOW + REVIEW_INTERVALS_MS[2] });
  });
  it('solve with help keeps the box and comes back tomorrow', () => {
    const r = gradeReview(item({ box: 2 }), { solved: true, clean: false }, NOW)!;
    expect(r).toMatchObject({ box: 2, reps: 0, due: NOW + DAY, lastAt: NOW });
  });
  it('failure lapses', () => {
    const r = gradeReview(item({ box: 4 }), { solved: false, clean: false }, NOW)!;
    expect(r).toMatchObject({ box: 0, lapses: 1, lastAt: NOW });
  });
  it('a clean solve in the top box graduates', () => {
    expect(gradeReview(item({ box: REVIEW_MAX_BOX }), { solved: true, clean: true }, NOW)).toBeNull();
    expect(gradeReview(item({ box: REVIEW_MAX_BOX - 1 }), { solved: true, clean: true }, NOW)?.box).toBe(REVIEW_MAX_BOX);
  });
  it('intervals grow strictly', () => {
    for (let i = 1; i < REVIEW_INTERVALS_MS.length; i++) expect(REVIEW_INTERVALS_MS[i]).toBeGreaterThan(REVIEW_INTERVALS_MS[i - 1]);
  });
});

describe('dueReviews / reviewSummary', () => {
  const items = [item({ puzzleId: 'a', due: NOW - 10 }), item({ puzzleId: 'b', due: NOW + 500 }), item({ puzzleId: 'c', due: NOW - 99 }), item({ puzzleId: 'd', due: NOW + 100 })];
  it('lists due items, most overdue first, with a limit', () => {
    expect(dueReviews(items, NOW).map((i) => i.puzzleId)).toEqual(['c', 'a']);
    expect(dueReviews(items, NOW, 1).map((i) => i.puzzleId)).toEqual(['c']);
  });
  it('summarises the queue', () => {
    expect(reviewSummary(items, NOW)).toEqual({ due: 2, total: 4, nextDueAt: NOW + 100 });
    expect(reviewSummary([], NOW)).toEqual({ due: 0, total: 0, nextDueAt: null });
  });
});

describe('formatInterval', () => {
  it('picks a sensible unit', () => {
    expect(formatInterval(10 * 60_000)).toBe('10 min');
    expect(formatInterval(3 * 3_600_000)).toBe('3 h');
    expect(formatInterval(DAY)).toBe('1 day');
    expect(formatInterval(16 * DAY)).toBe('16 days');
  });
});

describe('ingestAttempts', () => {
  const att = (id: number, puzzleId: string, solved: boolean, mode = 'rated'): MissAttempt => ({ id, puzzleId, puzzleRating: 1300, solved, mode, at: NOW + id });
  it('queues misses and ignores solves, review and custom attempts', () => {
    const out = ingestAttempts(new Map(), [att(1, 'a', false), att(2, 'b', true), att(3, 'c', false, 'review'), att(4, 'd', false, 'custom'), att(5, 'e', false, 'rush')]);
    expect(out.map((r) => r.puzzleId).sort()).toEqual(['a', 'e']);
    expect(out.every((r) => r.box === 0 && r.lapses === 0)).toBe(true);
  });
  it('a miss on a queued puzzle is a lapse, and repeats in one batch stack', () => {
    const existing = new Map([['a', item({ puzzleId: 'a', box: 3 })]]);
    const out = ingestAttempts(existing, [att(1, 'a', false), att(2, 'a', false), att(3, 'z', false), att(4, 'z', false)]);
    const a = out.find((r) => r.puzzleId === 'a')!;
    const z = out.find((r) => r.puzzleId === 'z')!;
    expect(a).toMatchObject({ box: 0, lapses: 2 });
    expect(z).toMatchObject({ box: 0, lapses: 1 });
    expect(out).toHaveLength(2);
  });
  it('returns nothing when there is nothing to write', () => {
    expect(ingestAttempts(new Map(), [att(1, 'a', true)])).toEqual([]);
  });
});
