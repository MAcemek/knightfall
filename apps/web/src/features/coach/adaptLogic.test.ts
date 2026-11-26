import { describe, expect, it } from 'vitest';
import type { Pace } from '../woodpecker/woodLogic.ts';
import {
  adaptTasks, CHECK_HARD, checkTarget, clockNote, countFocusAttempts, NO_ADAPT, pickFocus, woodAdvice, woodAdviceText, type Adapt, type ThemeRow,
} from './adaptLogic.ts';
import { todayTasks } from './todayLogic.ts';

const rows = (theme: string, solved: number, missed: number): ThemeRow[] => [
  ...Array.from({ length: solved }, () => ({ themes: [theme], solved: true })),
  ...Array.from({ length: missed }, () => ({ themes: [theme], solved: false })),
];

describe('pickFocus', () => {
  it('is null for a new player', () => {
    expect(pickFocus([], [], 0)).toBeNull();
  });
  it('takes the weakest theme with at least 5 tries', () => {
    const f = pickFocus([...rows('fork', 3, 4), ...rows('pin', 6, 1), ...rows('skewer', 0, 3)], [], 0);
    expect(f).toEqual({ theme: 'fork', source: 'weak', reason: 'You solve 43% of fork puzzles' });
  });
  it('ignores themes tried fewer than 5 times', () => {
    expect(pickFocus(rows('fork', 0, 4), [], 0)).toBeNull();
  });
  it('prefers the most frequent mistake motif once 3 games are reviewed', () => {
    const motifs = [
      { label: 'Lost material to a tactic', theme: null, count: 9, games: 3 },
      { label: 'Walked into a fork', theme: 'fork', count: 5, games: 3 },
      { label: 'Left a piece hanging', theme: 'hangingPiece', count: 3, games: 2 },
    ];
    const f = pickFocus(rows('pin', 1, 5), motifs, 3);
    expect(f).toEqual({ theme: 'fork', source: 'mistakes', reason: 'Walked into a fork: 5 times in 3 games' });
  });
  it('falls back to the weak theme with fewer than 3 reviewed games or a rare motif', () => {
    const motifs = [{ label: 'Walked into a fork', theme: 'fork', count: 5, games: 2 }];
    expect(pickFocus(rows('pin', 1, 5), motifs, 2)?.source).toBe('weak');
    expect(pickFocus(rows('pin', 1, 5), [{ label: 'x', theme: 'fork', count: 1, games: 1 }], 5)?.source).toBe('weak');
  });
});

describe('countFocusAttempts', () => {
  it('counts only theme-trainer attempts of that theme', () => {
    const list = [
      { mode: 'theme', themes: ['fork', 'short'] },
      { mode: 'theme', themes: ['pin'] },
      { mode: 'rated', themes: ['fork'] },
      { mode: 'theme' },
      { mode: 'theme', themes: ['fork'] },
    ];
    expect(countFocusAttempts(list, 'fork')).toBe(2);
  });
});

const pace = (over: Partial<Pace>): Pace => ({ dayIndex: 5, targetDays: 10, expectedDone: 50, done: 50, doneToday: 0, todayQuota: 0, todayGoal: 0, state: 'on-pace', ...over });

describe('woodAdvice', () => {
  it('is null when on pace, done, overdue or with no puzzles', () => {
    expect(woodAdvice(pace({}), 100)).toBeNull();
    expect(woodAdvice(pace({ state: 'done' }), 100)).toBeNull();
    expect(woodAdvice(pace({ state: 'overdue' }), 100)).toBeNull();
    expect(woodAdvice(pace({ state: 'behind' }), 0)).toBeNull();
  });
  it('is null when behind by no more than one day', () => {
    // 10 a day, expected 50, done 30: 40 expected before today, 10 behind = one day's quota.
    expect(woodAdvice(pace({ state: 'behind', done: 30 }), 100)).toBeNull();
  });
  it('splits the catch-up over the next days', () => {
    const a = woodAdvice(pace({ state: 'behind', done: 20 }), 100);
    expect(a).toEqual({ kind: 'behind', behind: 20, today: 10, extra: 7, days: 3 });
    expect(woodAdviceText(a!)).toBe('You are 20 puzzles behind pace. Do about 10 today, then add 7 a day for the next 3 days.');
  });
  it('keeps the backlog fixed while the quota of the day is worked through', () => {
    const before = woodAdvice(pace({ state: 'behind', done: 20 }), 100);
    const during = woodAdvice(pace({ state: 'behind', done: 28, doneToday: 8 }), 100);
    const after = woodAdvice(pace({ state: 'behind', done: 36, doneToday: 16 }), 100);
    expect(during).toEqual(before);
    expect(after).toEqual(before);
  });
  it('uses fewer days near the end of the cycle', () => {
    const a = woodAdvice(pace({ state: 'behind', done: 20, dayIndex: 9 }), 100);
    expect(a).toMatchObject({ days: 1, extra: 20 });
    expect(woodAdviceText(a!)).toContain('add 20 tomorrow');
  });
  it('says so when ahead', () => {
    const a = woodAdvice(pace({ state: 'ahead', done: 62 }), 100);
    expect(a).toEqual({ kind: 'ahead', by: 12 });
    expect(woodAdviceText(a!)).toBe('Ahead of pace by 12 puzzles. 15 minutes is enough today.');
  });
});

describe('checkTarget and clockNote', () => {
  it('doubles the blunder check for 2 or more blunders a game', () => {
    expect(checkTarget(null, 0)).toBe(10);
    expect(checkTarget(1.9, 10)).toBe(10);
    expect(checkTarget(2, 10)).toBe(CHECK_HARD);
    expect(checkTarget(3, 2)).toBe(10);
  });
  it('mentions the clock only when it is low', () => {
    expect(clockNote({ share: null, state: null })).toBeNull();
    expect(clockNote({ share: 0.8, state: 'good' })).toBeNull();
    expect(clockNote({ share: 0.48, state: 'low' })).toBe('Use at least 60% of your clock. You used 48% lately.');
  });
});

describe('adaptTasks', () => {
  const ids = (a: Adapt, d: string) => adaptTasks(todayTasks(d), a).map((t) => t.id);
  it('changes nothing with no data', () => {
    expect(adaptTasks(todayTasks('2026-11-16'), NO_ADAPT)).toEqual(todayTasks('2026-11-16'));
    expect(adaptTasks(todayTasks('2026-11-21'), NO_ADAPT)).toEqual(todayTasks('2026-11-21'));
  });
  it('adds the focus task after the blunder check on weekdays', () => {
    const focus = { theme: 'fork', source: 'weak' as const, reason: 'You solve 42% of fork puzzles' };
    expect(ids({ ...NO_ADAPT, focus }, '2026-11-16')).toEqual(['wood', 'rush', 'check', 'focus', 'study', 'daily']);
    const t = adaptTasks(todayTasks('2026-11-16'), { ...NO_ADAPT, focus }).find((x) => x.id === 'focus')!;
    expect(t).toMatchObject({ title: 'Focus: Fork, 10 puzzles', to: '/train/theme/fork', kind: 'auto', detail: 'You solve 42% of fork puzzles' });
  });
  it('words the Woodpecker task from the advice', () => {
    const wood = adaptTasks(todayTasks('2026-11-16'), { ...NO_ADAPT, wood: { kind: 'ahead', by: 5 } })[0];
    expect(wood.minutes).toBe(15);
    expect(wood.detail).toContain('Ahead of pace by 5 puzzles');
  });
  it('raises the blunder check target', () => {
    const c = adaptTasks(todayTasks('2026-11-16'), { ...NO_ADAPT, checkTarget: 20 }).find((x) => x.id === 'check')!;
    expect(c.title).toBe('Blunder check, 20 positions');
    expect(c.minutes).toBe(10);
  });
  it('adds the clock line to the weekend rapid task only', () => {
    const t = adaptTasks(todayTasks('2026-11-21'), { ...NO_ADAPT, clock: 'Use at least 60% of your clock.' });
    expect(t.find((x) => x.id === 'rapid')!.detail).toContain('Use at least 60% of your clock.');
    expect(t.find((x) => x.id === 'review')!.detail).not.toContain('clock');
  });
  it('makes the review task manual when self review is off', () => {
    const r = adaptTasks(todayTasks('2026-11-21'), { ...NO_ADAPT, selfReview: false }).find((x) => x.id === 'review')!;
    expect(r.kind).toBe('manual');
    expect(r.detail).toContain('Settings');
  });
});
