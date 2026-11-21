import { describe, expect, it } from 'vitest';
import { BACKOFF_MAX_MS, BACKOFF_MIN_MS, helloChanged, nextBackoff, statusAfterFailure } from './connectionLogic.ts';

describe('nextBackoff', () => {
  it('doubles from 1 s and caps at 30 s', () => {
    const seq = [BACKOFF_MIN_MS];
    for (let i = 0; i < 7; i++) seq.push(nextBackoff(seq[seq.length - 1]!));
    expect(seq).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(nextBackoff(0)).toBe(BACKOFF_MIN_MS);
    expect(nextBackoff(BACKOFF_MAX_MS)).toBe(BACKOFF_MAX_MS);
  });
});

describe('statusAfterFailure', () => {
  it('is waking inside the wake window and offline after it', () => {
    expect(statusAfterFailure(75_000, 1000, 2000)).toBe('waking');
    expect(statusAfterFailure(75_000, 1000, 1000 + 75_000)).toBe('offline');
  });
  it('is offline straight away when there is no wake window', () => {
    expect(statusAfterFailure(0, 1000, 1001)).toBe('offline');
  });
});

describe('helloChanged', () => {
  const a = { name: 'Ann', rating: 1200 };
  it('detects a first hello, a rename and a rating change', () => {
    expect(helloChanged(null, a)).toBe(true);
    expect(helloChanged(a, { ...a })).toBe(false);
    expect(helloChanged(a, { ...a, name: 'Bea' })).toBe(true);
    expect(helloChanged(a, { ...a, rating: 1216 })).toBe(true);
  });
});
