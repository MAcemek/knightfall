import { describe, expect, it } from 'vitest';
import type { Puzzle } from '@knightfall/core';
import type { Attempt, StoredGame } from '../../shared/db.ts';
import { autoState, cleanTicks, countRapidToday, dayBounds, nextTask, summary, todayTasks, toggleId, type AutoInputs } from './todayLogic.ts';

const local = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0).getTime();
const NOW = local(2026, 11, 18, 15);

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }) as unknown as Puzzle);
const set = (total: number, startedAt: number, targetDays: number) => ({ id: 's1', items: items(total), cycles: [{ n: 1, startedAt, finishedAt: null, targetDays }] });
const attempt = (i: number, at: number, over: Partial<Attempt> = {}): Attempt => ({
  id: i + 1, puzzleId: `p${i}`, mode: 'woodpecker', solved: true, puzzleRating: 1500, hintsUsed: 0, timeMs: 10_000, at, setId: 's1', cycle: 1, ...over,
});

const base: AutoInputs = {
  now: NOW, woodSet: null, woodSetAttempts: [], anyWoodSet: false, woodMsToday: 0, woodFinishedToday: false,
  rushToday: 0, checkToday: 0, rapidToday: 0, reviewsToday: 0,
};

describe('todayTasks', () => {
  const ids = (d: string) => todayTasks(d).map((t) => t.id);
  it('has five tasks on a weekday', () => {
    expect(ids('2026-11-16')).toEqual(['wood', 'rush', 'check', 'study', 'daily']);
    expect(ids('2026-11-20')).toEqual(['wood', 'rush', 'check', 'study', 'daily']);
  });
  it('picks the study task by weekday', () => {
    const study = (d: string) => todayTasks(d).find((t) => t.id === 'study')!;
    expect(study('2026-11-16')).toMatchObject({ to: '/train/endgames', minutes: 20 }); // Monday
    expect(study('2026-11-19')).toMatchObject({ to: '/train/endgames' }); // Thursday
    expect(study('2026-11-17')).toMatchObject({ to: '/train/openings' }); // Tuesday
    expect(study('2026-11-18')).toMatchObject({ to: '/coach/library' }); // Wednesday
    expect(study('2026-11-20')).toMatchObject({ to: '/coach/library' }); // Friday
  });
  it('has the weekend list with an optional blitz task', () => {
    expect(ids('2026-11-21')).toEqual(['rapid', 'review', 'missed', 'blitz']);
    expect(ids('2026-11-22')).toEqual(['rapid', 'review', 'missed', 'blitz']);
    const t = todayTasks('2026-11-21');
    expect(t[3].optional).toBe(true);
    expect(t.slice(0, 3).every((x) => !x.optional)).toBe(true);
    expect(t.find((x) => x.id === 'rapid')?.to).toBe('/play');
    expect(t.find((x) => x.id === 'review')?.to).toBe('/analysis');
  });
  it('marks auto and manual tasks', () => {
    const kinds = Object.fromEntries([...todayTasks('2026-11-16'), ...todayTasks('2026-11-21')].map((t) => [t.id, t.kind]));
    expect(kinds).toMatchObject({ wood: 'auto', rush: 'auto', check: 'auto', rapid: 'auto', review: 'auto', study: 'manual', daily: 'manual', missed: 'manual', blitz: 'manual' });
  });
  it('returns nothing for a bad date', () => {
    expect(todayTasks('nope')).toEqual([]);
  });
  it('returns fresh objects', () => {
    todayTasks('2026-11-16')[0].title = 'changed';
    expect(todayTasks('2026-11-16')[0].title).toBe('Woodpecker');
  });
});

describe('autoState wood', () => {
  // 10 puzzles over 5 days, started today: quota 2 today.
  const s = set(10, local(2026, 11, 18, 9), 5);
  it('says no set yet', () => {
    expect(autoState(base).wood).toEqual({ done: false, text: 'No set yet' });
    expect(autoState({ ...base, anyWoodSet: true }).wood.text).toBe('No cycle running');
  });
  it('is not done before anything is played', () => {
    expect(autoState({ ...base, woodSet: s, anyWoodSet: true }).wood).toEqual({ done: false, text: '0 of 2 today' });
  });
  it('is not done while the quota is open', () => {
    const w = autoState({ ...base, woodSet: s, anyWoodSet: true, woodSetAttempts: [attempt(0, NOW)] }).wood;
    expect(w).toEqual({ done: false, text: '1 of 2 today' });
  });
  it('is done when today quota is played', () => {
    const w = autoState({ ...base, woodSet: s, anyWoodSet: true, woodSetAttempts: [attempt(0, NOW), attempt(1, NOW)] }).wood;
    expect(w).toEqual({ done: true, text: '2 of 2 today' });
  });
  it('is done when ahead of pace and something was played today', () => {
    const more = [0, 1, 2, 3].map((i) => attempt(i, NOW));
    const w = autoState({ ...base, woodSet: s, anyWoodSet: true, woodSetAttempts: more }).wood;
    expect(w.done).toBe(true);
    expect(w.text).toBe('4 of 4 today');
  });
  it('ahead from earlier days but nothing today is not done', () => {
    const early = [0, 1, 2, 3, 4, 5].map((i) => attempt(i, local(2026, 11, 17, 10)));
    const long = set(10, local(2026, 11, 14, 9), 5);
    const w = autoState({ ...base, woodSet: long, anyWoodSet: true, woodSetAttempts: early }).wood;
    expect(w.done).toBe(false);
  });
  it('25 minutes of attempts count even when the quota is open', () => {
    expect(autoState({ ...base, woodSet: s, anyWoodSet: true, woodMsToday: 25 * 60_000 }).wood.done).toBe(true);
    expect(autoState({ ...base, woodSet: s, anyWoodSet: true, woodMsToday: 25 * 60_000 - 1 }).wood.done).toBe(false);
  });
  it('a cycle finished today counts when the set is no longer active', () => {
    expect(autoState({ ...base, anyWoodSet: true, woodFinishedToday: true }).wood).toEqual({ done: true, text: 'Cycle finished today' });
    // The next cycle already started: the text must not read "0 of 1 today".
    expect(autoState({ ...base, woodSet: s, anyWoodSet: true, woodFinishedToday: true }).wood).toEqual({ done: true, text: 'Cycle finished today' });
    expect(autoState({ ...base, anyWoodSet: true, woodMsToday: 30 * 60_000 }).wood).toEqual({ done: true, text: '30 minutes today' });
  });
});

describe('autoState other tasks', () => {
  it('rush: any run today', () => {
    expect(autoState(base).rush).toEqual({ done: false, text: 'No run yet' });
    expect(autoState({ ...base, rushToday: 1 }).rush).toEqual({ done: true, text: '1 run' });
    expect(autoState({ ...base, rushToday: 3 }).rush.text).toBe('3 runs');
  });
  it('check: 10 positions', () => {
    expect(autoState({ ...base, checkToday: 9 }).check).toEqual({ done: false, text: '9 of 10' });
    expect(autoState({ ...base, checkToday: 10 }).check.done).toBe(true);
    expect(autoState({ ...base, checkToday: 14 }).check.text).toBe('10 of 10');
  });
  it('rapid: 2 games', () => {
    expect(autoState({ ...base, rapidToday: 1 }).rapid).toEqual({ done: false, text: '1 of 2' });
    expect(autoState({ ...base, rapidToday: 2 }).rapid.done).toBe(true);
  });
  it('review: as many as games, between 1 and 3', () => {
    expect(autoState(base).review).toEqual({ done: false, text: '0 of 1' });
    expect(autoState({ ...base, reviewsToday: 1 }).review.done).toBe(true);
    expect(autoState({ ...base, rapidToday: 2, reviewsToday: 1 }).review).toEqual({ done: false, text: '1 of 2' });
    expect(autoState({ ...base, rapidToday: 2, reviewsToday: 2 }).review.done).toBe(true);
    expect(autoState({ ...base, rapidToday: 5, reviewsToday: 2 }).review).toEqual({ done: false, text: '2 of 3' });
    expect(autoState({ ...base, rapidToday: 5, reviewsToday: 3 }).review.done).toBe(true);
  });
});

describe('countRapidToday', () => {
  const users = { lichessUser: '', chesscomUser: 'sample' };
  const g = (over: Partial<StoredGame>): Pick<StoredGame, 'source' | 'white' | 'black' | 'importedFor' | 'speed' | 'playedAt'> => ({
    source: 'chesscom', white: { name: 'Sample' }, black: { name: 'Other' }, speed: 'rapid', playedAt: NOW, ...over,
  });
  it('counts rapid games of the day with a known side, bot games included', () => {
    const games = [
      g({}),
      g({ source: 'bot', white: { name: 'Bot' }, black: { name: 'Me' }, importedFor: 'me' }),
      g({ speed: 'blitz' }),
      g({ playedAt: local(2026, 11, 17, 23, 59) }),
      g({ white: { name: 'A' }, black: { name: 'B' } }),
      g({ source: 'pgn', speed: 'rapid' }),
    ];
    expect(countRapidToday(games, users, '2026-11-18')).toBe(2);
  });
});

describe('summary and ticks', () => {
  it('counts auto and manual tasks, leaving optional ones out', () => {
    const tasks = todayTasks('2026-11-21');
    const auto = autoState({ ...base, rapidToday: 2, reviewsToday: 2 });
    expect(summary(tasks, auto, [])).toEqual({ done: 2, total: 3 });
    expect(summary(tasks, auto, ['missed', 'blitz'])).toEqual({ done: 3, total: 3 });
    expect(summary(todayTasks('2026-11-16'), autoState(base), ['study', 'daily'])).toEqual({ done: 2, total: 5 });
  });
  it('cleanTicks keeps known manual ids once', () => {
    expect(cleanTicks(['study', 'study', 'wood', 5, 'daily'])).toEqual(['study', 'daily']);
    expect(cleanTicks('x')).toEqual([]);
  });
  it('toggleId switches only manual ids', () => {
    expect(toggleId([], 'study')).toEqual(['study']);
    expect(toggleId(['study', 'daily'], 'study')).toEqual(['daily']);
    expect(toggleId(['study'], 'wood')).toEqual(['study']);
  });
});

describe('dayBounds', () => {
  it('spans the local day', () => {
    const { start, end } = dayBounds('2026-11-18');
    expect(start).toBe(local(2026, 11, 18, 0));
    expect(end).toBe(local(2026, 11, 19, 0));
    expect(NOW >= start && NOW < end).toBe(true);
  });
});

describe('adapted auto state', () => {
  it('uses the blunder check target it is given', () => {
    expect(autoState({ ...base, checkToday: 12, checkTarget: 20 }).check).toEqual({ done: false, text: '12 of 20' });
    expect(autoState({ ...base, checkToday: 20, checkTarget: 20 }).check.done).toBe(true);
  });
  it('ticks the focus task at 10 attempts of the theme', () => {
    expect(autoState(base).focus).toEqual({ done: false, text: '0 of 10' });
    expect(autoState({ ...base, focusToday: 9 }).focus).toEqual({ done: false, text: '9 of 10' });
    expect(autoState({ ...base, focusToday: 14 }).focus).toEqual({ done: true, text: '10 of 10' });
  });
  it('lowers the Woodpecker minutes when ahead of pace', () => {
    const ms = 16 * 60_000;
    expect(autoState({ ...base, anyWoodSet: true, woodMsToday: ms }).wood.done).toBe(false);
    expect(autoState({ ...base, anyWoodSet: true, woodMsToday: ms, woodMinutes: 15 }).wood.done).toBe(true);
  });
});

describe('nextTask', () => {
  const tasks = todayTasks('2026-11-16');
  it('is the first task not done', () => {
    expect(nextTask(tasks, autoState(base), [])?.id).toBe('wood');
    expect(nextTask(tasks, autoState({ ...base, rushToday: 1, woodMsToday: 30 * 60_000, anyWoodSet: true }), [])?.id).toBe('check');
  });
  it('skips ticked manual tasks and optional ones, and is null when all are done', () => {
    const done = autoState({ ...base, rushToday: 1, woodMsToday: 30 * 60_000, anyWoodSet: true, checkToday: 10 });
    expect(nextTask(tasks, done, ['study'])?.id).toBe('daily');
    expect(nextTask(tasks, done, ['study', 'daily'])).toBeNull();
    const weekend = todayTasks('2026-11-21');
    const wDone = autoState({ ...base, rapidToday: 2, reviewsToday: 2 });
    expect(nextTask(weekend, wDone, ['missed'])).toBeNull();
  });
  it('treats an unticked manual review task as not done', () => {
    const review = { id: 'review' as const, title: 'r', detail: '', minutes: 1, to: '/', kind: 'manual' as const };
    expect(nextTask([review], autoState({ ...base, rapidToday: 1, reviewsToday: 1 }), [])?.id).toBe('review');
    expect(nextTask([review], autoState(base), ['review'])).toBeNull();
    expect(cleanTicks(['review'])).toEqual(['review']);
  });
});
