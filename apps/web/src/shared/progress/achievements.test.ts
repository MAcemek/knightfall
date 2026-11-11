import { describe, expect, it } from 'vitest';
import {
  achievementById, achievementProgress, ACHIEVEMENTS, buildSnapshot, ESTABLISHED_AFTER, evaluateAchievements, longestDayRun, newlyEarned,
  type ProgressSnapshot, type SnapshotInput,
} from './achievements.ts';

const ZERO: ProgressSnapshot = {
  solvedTotal: 0, ratedCount: 0, establishedRating: 0, bestStreak: 0, dailySolved: 0, dailyBestStreak: 0,
  rushBest: 0, rushBestCombo: 0, battleWins: 0, themeSolved: 0, reviewSolved: 0, customCreated: 0,
};
const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  attempts: [], rushRuns: [], battles: [], daily: [], puzzleRating: 1200, puzzleStreak: { current: 0, best: 0 }, customCount: 0, ...over,
});

describe('definitions', () => {
  it('have unique ids and positive targets', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.every((a) => a.target > 0 && a.title && a.desc)).toBe(true);
    expect(achievementById('solve-1')?.title).toBe('First Spark');
    expect(achievementById('nope')).toBeUndefined();
  });
});

describe('evaluateAchievements', () => {
  it('a fresh profile has earned nothing', () => {
    expect(evaluateAchievements(ZERO)).toEqual([]);
  });
  it('unlocks exactly at the target', () => {
    expect(evaluateAchievements({ ...ZERO, solvedTotal: 49 })).toEqual(['solve-1']);
    expect(evaluateAchievements({ ...ZERO, solvedTotal: 50 })).toEqual(['solve-1', 'solve-50']);
    expect(evaluateAchievements({ ...ZERO, rushBest: 20, rushBestCombo: 10 })).toEqual(['rush-10', 'rush-20', 'combo-10']);
  });
  it('newlyEarned skips what is already unlocked', () => {
    const s = { ...ZERO, solvedTotal: 60, battleWins: 1 };
    expect(newlyEarned(s, new Set(['solve-1']))).toEqual(['solve-50', 'battle-1']);
    expect(newlyEarned(s, new Set(['solve-1', 'solve-50', 'battle-1']))).toEqual([]);
  });
});

describe('achievementProgress', () => {
  it('clamps to the target', () => {
    const a = achievementById('solve-50')!;
    expect(achievementProgress(a, { ...ZERO, solvedTotal: 20 })).toEqual({ value: 20, target: 50, ratio: 0.4 });
    expect(achievementProgress(a, { ...ZERO, solvedTotal: 900 })).toEqual({ value: 50, target: 50, ratio: 1 });
  });
});

describe('longestDayRun', () => {
  it('finds the longest consecutive run across month boundaries', () => {
    expect(longestDayRun([])).toBe(0);
    expect(longestDayRun(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-03'])).toBe(3);
    expect(longestDayRun(['2026-03-05', '2026-03-07', '2026-03-09'])).toBe(1);
  });
});

describe('buildSnapshot', () => {
  it('counts attempts by mode', () => {
    const s = buildSnapshot(input({
      attempts: [
        { mode: 'rated', solved: true }, { mode: 'rated', solved: false }, { mode: 'theme', solved: true },
        { mode: 'review', solved: true }, { mode: 'review', solved: false }, { mode: 'rush', solved: true },
      ],
    }));
    expect(s).toMatchObject({ solvedTotal: 4, ratedCount: 2, themeSolved: 1, reviewSolved: 1 });
  });
  it('hides a provisional rating', () => {
    const few = Array.from({ length: ESTABLISHED_AFTER - 1 }, () => ({ mode: 'rated' as const, solved: true }));
    expect(buildSnapshot(input({ attempts: few, puzzleRating: 1650.4 })).establishedRating).toBe(0);
    expect(buildSnapshot(input({ attempts: [...few, { mode: 'rated', solved: false }], puzzleRating: 1650.4 })).establishedRating).toBe(1650);
  });
  it('aggregates rush, battle, daily, streak and custom', () => {
    const s = buildSnapshot(input({
      rushRuns: [{ score: 12, bestCombo: 6 }, { score: 21, bestCombo: 4 }],
      battles: [{ result: 'win' }, { result: 'loss' }, { result: 'win' }, { result: 'draw' }],
      daily: [{ date: '2026-05-01', solved: true }, { date: '2026-05-02', solved: true }, { date: '2026-05-03', solved: false }],
      puzzleStreak: { current: 2, best: 9 },
      customCount: 3,
    }));
    expect(s).toMatchObject({ rushBest: 21, rushBestCombo: 6, battleWins: 2, dailySolved: 2, dailyBestStreak: 2, bestStreak: 9, customCreated: 3 });
  });
});
