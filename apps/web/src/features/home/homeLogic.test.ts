import { describe, expect, it } from 'vitest';
import { goalProgress, isReturning, solvedToday, startOfLocalDay } from './homeLogic.ts';

const NOW = new Date(2026, 10, 27, 15, 30).getTime();
const START = startOfLocalDay(NOW);

describe('isReturning', () => {
  it('is false with nothing played', () => {
    expect(isReturning({ attempts: 0, battles: 0, dailies: 0 })).toBe(false);
  });
  it('is true when any count is above zero', () => {
    expect(isReturning({ attempts: 1, battles: 0, dailies: 0 })).toBe(true);
    expect(isReturning({ attempts: 0, battles: 2, dailies: 0 })).toBe(true);
    expect(isReturning({ attempts: 0, battles: 0, dailies: 1 })).toBe(true);
  });
});

describe('startOfLocalDay', () => {
  it('is local midnight', () => {
    const d = new Date(START);
    expect([d.getHours(), d.getMinutes(), d.getDate()]).toEqual([0, 0, 27]);
  });
});

describe('solvedToday', () => {
  const base = { attempts: [], battles: [], daily: undefined, now: NOW };
  it('is zero with nothing', () => {
    expect(solvedToday(base)).toBe(0);
  });
  it('counts only solved attempts from today', () => {
    expect(
      solvedToday({
        ...base,
        attempts: [
          { solved: true, at: START },
          { solved: true, at: NOW },
          { solved: false, at: NOW },
          { solved: true, at: START - 1 },
        ],
      }),
    ).toBe(2);
  });
  it('adds battle puzzles solved today', () => {
    expect(
      solvedToday({
        ...base,
        battles: [
          { at: NOW, you: { solved: 4 } },
          { at: START - 5, you: { solved: 9 } },
        ],
      }),
    ).toBe(4);
  });
  it('adds one for a Daily solved today, once', () => {
    const daily = { solved: true, at: NOW };
    expect(solvedToday({ ...base, daily })).toBe(1);
    expect(solvedToday({ ...base, daily: { solved: false, at: NOW } })).toBe(0);
    expect(solvedToday({ ...base, daily: { solved: true, at: START - 1 } })).toBe(0);
  });
  it('sums every source without double counting', () => {
    expect(
      solvedToday({
        attempts: [{ solved: true, at: NOW }, { solved: true, at: NOW }],
        battles: [{ at: NOW, you: { solved: 3 } }],
        daily: { solved: true, at: NOW },
        now: NOW,
      }),
    ).toBe(6);
  });
});

describe('goalProgress', () => {
  it('is null when the goal is off', () => {
    expect(goalProgress(5, 0)).toBeNull();
  });
  it('is a fraction clamped to 0..1', () => {
    expect(goalProgress(4, 10)).toBe(0.4);
    expect(goalProgress(25, 10)).toBe(1);
    expect(goalProgress(-3, 10)).toBe(0);
  });
});
