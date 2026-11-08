import { describe, expect, it } from 'vitest';
import { acceptProgress, canClaim, endReason, resultFor } from './rules.ts';

const s = (solved: number, strikes: number) => ({ solved, strikes });

describe('acceptProgress', () => {
  const start = 1000;
  it('ignores reports before the start', () => {
    expect(acceptProgress(s(0, 0), { solved: 1, strikes: 0, index: 0 }, 999, start)).toBeNull();
  });
  it('accepts +1 solved or +1 strike', () => {
    expect(acceptProgress(s(0, 0), { solved: 1, strikes: 0, index: 0 }, start, start)).toEqual(s(1, 0));
    expect(acceptProgress(s(1, 0), { solved: 1, strikes: 1, index: 1 }, start, start)).toEqual(s(1, 1));
  });
  it('rejects decreases, jumps and both at once', () => {
    expect(acceptProgress(s(2, 1), { solved: 1, strikes: 1, index: 3 }, start, start)).toBeNull();
    expect(acceptProgress(s(2, 1), { solved: 2, strikes: 0, index: 3 }, start, start)).toBeNull();
    expect(acceptProgress(s(0, 0), { solved: 2, strikes: 0, index: 1 }, start, start)).toBeNull();
    expect(acceptProgress(s(0, 0), { solved: 1, strikes: 1, index: 1 }, start, start)).toBeNull();
  });
  it('rejects more than 3 strikes and reports once struck out', () => {
    expect(acceptProgress(s(0, 3), { solved: 1, strikes: 3, index: 4 }, start, start)).toBeNull();
    expect(acceptProgress(s(0, 2), { solved: 0, strikes: 3, index: 2 }, start, start)).toEqual(s(0, 3));
  });
  it('rejects malformed values', () => {
    expect(acceptProgress(s(0, 0), { solved: '1', strikes: 0, index: 0 }, start, start)).toBeNull();
    expect(acceptProgress(s(0, 0), { solved: 1.5, strikes: 0, index: 0 }, start, start)).toBeNull();
    expect(acceptProgress(s(0, 0), { solved: 1, strikes: 0, index: -1 }, start, start)).toBeNull();
    expect(acceptProgress(s(0, 0), { solved: 1, strikes: null, index: 0 }, start, start)).toBeNull();
  });
});

describe('endReason', () => {
  const endsAt = 10_000;
  it('ends on time', () => {
    expect(endReason(s(0, 0), s(0, 0), endsAt, endsAt)).toBe('time');
    expect(endReason(s(0, 0), s(0, 0), endsAt - 1, endsAt)).toBeNull();
  });
  it('ends when both struck out', () => {
    expect(endReason(s(4, 3), s(4, 3), 0, endsAt)).toBe('strikes');
  });
  it('ends when one struck out and the other is strictly ahead', () => {
    expect(endReason(s(3, 3), s(4, 0), 0, endsAt)).toBe('strikes');
    expect(endReason(s(5, 1), s(2, 3), 0, endsAt)).toBe('strikes');
  });
  it('keeps going while the survivor can still catch up or is tied', () => {
    expect(endReason(s(5, 3), s(4, 0), 0, endsAt)).toBeNull();
    expect(endReason(s(4, 3), s(4, 2), 0, endsAt)).toBeNull();
  });
});

describe('resultFor', () => {
  it('compares solved counts', () => {
    expect(resultFor(s(5, 3), s(4, 0))).toBe('win');
    expect(resultFor(s(2, 0), s(4, 3))).toBe('loss');
    expect(resultFor(s(4, 1), s(4, 2))).toBe('draw');
  });
});

describe('bot play-on and claim', () => {
  const out = { solved: 3, strikes: 3 };
  const ahead = { solved: 5, strikes: 1 };
  it('keeps going when a struck-out BOT trails a human', () => {
    expect(endReason(ahead, out, 0, 1000, { b: true })).toBeNull();
    expect(endReason(ahead, out, 0, 1000)).toBe('strikes');
  });
  it('still ends when the human also strikes out or time runs out', () => {
    expect(endReason({ solved: 5, strikes: 3 }, out, 0, 1000, { b: true })).toBe('strikes');
    expect(endReason(ahead, out, 1000, 1000, { b: true })).toBe('time');
  });
  it('allows claiming only vs a struck-out bot while strictly ahead', () => {
    expect(canClaim(ahead, out, true)).toBe(true);
    expect(canClaim(ahead, out, false)).toBe(false);
    expect(canClaim({ solved: 3, strikes: 0 }, out, true)).toBe(false);
    expect(canClaim(ahead, { solved: 3, strikes: 2 }, true)).toBe(false);
  });
});
