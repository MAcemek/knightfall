import { addDays } from '@knightfall/core';
import type { Attempt, BattleRecord, DailyRecord, RushRun, StreakState } from '../db.ts';

/** Achievements: definitions + a pure evaluator over a snapshot of the player's local history. */

/** Everything the achievement rules look at. All numbers, so rules are just "metric ≥ target". */
export interface ProgressSnapshot {
  /** Solved attempts in any mode. */
  solvedTotal: number;
  /** Rated attempts (solved or not). */
  ratedCount: number;
  /** Current puzzle rating (rounded); 0 until 10 rated puzzles are played so a provisional rating unlocks nothing. */
  establishedRating: number;
  /** Best clean-solve streak in rated puzzles. */
  bestStreak: number;
  /** Daily puzzles solved on their own day. */
  dailySolved: number;
  /** Longest run of consecutive solved days. */
  dailyBestStreak: number;
  /** Best Rush score in any mode. */
  rushBest: number;
  rushBestCombo: number;
  battleWins: number;
  /** Solved theme-training puzzles. */
  themeSolved: number;
  /** Solved review puzzles. */
  reviewSolved: number;
  customCreated: number;
}

export type Metric = keyof ProgressSnapshot;
export type AchievementTier = 'bronze' | 'silver' | 'gold';
/** Keys of `Icons` in shared/ui.tsx. */
export type AchievementIcon = 'puzzle' | 'flame' | 'chart' | 'calendar' | 'bolt' | 'swords' | 'target' | 'layers' | 'pencil' | 'trophy';

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  icon: AchievementIcon;
  tier: AchievementTier;
  metric: Metric;
  target: number;
}

const def = (id: string, title: string, desc: string, icon: AchievementIcon, tier: AchievementTier, metric: Metric, target: number): AchievementDef => ({
  id, title, desc, icon, tier, metric, target,
});

/** Order = display order. Ids are persisted: never rename or reuse one. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  def('solve-1', 'First Spark', 'Solve your first puzzle.', 'puzzle', 'bronze', 'solvedTotal', 1),
  def('solve-50', 'Kindling', 'Solve 50 puzzles.', 'puzzle', 'bronze', 'solvedTotal', 50),
  def('solve-250', 'Bonfire', 'Solve 250 puzzles.', 'puzzle', 'silver', 'solvedTotal', 250),
  def('solve-1000', 'Wildfire', 'Solve 1,000 puzzles.', 'puzzle', 'gold', 'solvedTotal', 1000),
  def('streak-5', 'Warm Hands', 'Solve 5 rated puzzles in a row, clean.', 'flame', 'bronze', 'bestStreak', 5),
  def('streak-10', 'On a Roll', 'Solve 10 rated puzzles in a row, clean.', 'flame', 'silver', 'bestStreak', 10),
  def('streak-20', 'Unbroken', 'Solve 20 rated puzzles in a row, clean.', 'flame', 'gold', 'bestStreak', 20),
  def('rating-1400', 'Climber', 'Reach a puzzle rating of 1400.', 'chart', 'bronze', 'establishedRating', 1400),
  def('rating-1600', 'Sharp Eye', 'Reach a puzzle rating of 1600.', 'chart', 'silver', 'establishedRating', 1600),
  def('rating-1800', 'Tactician', 'Reach a puzzle rating of 1800.', 'chart', 'silver', 'establishedRating', 1800),
  def('rating-2000', 'Nightfall', 'Reach a puzzle rating of 2000.', 'chart', 'gold', 'establishedRating', 2000),
  def('daily-1', 'Early Bird', 'Solve a daily puzzle on its day.', 'calendar', 'bronze', 'dailySolved', 1),
  def('daily-7', 'Seven Suns', 'Solve the daily puzzle 7 days in a row.', 'calendar', 'silver', 'dailyBestStreak', 7),
  def('daily-30', 'Full Moon', 'Solve the daily puzzle 30 days in a row.', 'calendar', 'gold', 'dailyBestStreak', 30),
  def('rush-10', 'Quick Hands', 'Score 10 in Puzzle Rush.', 'bolt', 'bronze', 'rushBest', 10),
  def('rush-20', 'Lightning', 'Score 20 in Puzzle Rush.', 'bolt', 'silver', 'rushBest', 20),
  def('rush-30', 'Storm Front', 'Score 30 in Puzzle Rush.', 'bolt', 'gold', 'rushBest', 30),
  def('combo-10', 'Chain Reaction', 'Reach a ×10 combo in Puzzle Rush.', 'bolt', 'silver', 'rushBestCombo', 10),
  def('battle-1', 'First Blood', 'Win a Puzzle Battle.', 'swords', 'bronze', 'battleWins', 1),
  def('battle-10', 'Duelist', 'Win 10 Puzzle Battles.', 'swords', 'gold', 'battleWins', 10),
  def('theme-25', 'Specialist', 'Solve 25 puzzles in theme training.', 'target', 'silver', 'themeSolved', 25),
  def('review-10', 'Second Chances', 'Solve 10 puzzles from your review queue.', 'layers', 'silver', 'reviewSolved', 10),
  def('custom-1', 'Composer', 'Create a custom puzzle.', 'pencil', 'bronze', 'customCreated', 1),
];

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Ids of every achievement the snapshot satisfies (definition order). */
export function evaluateAchievements(s: ProgressSnapshot): string[] {
  return ACHIEVEMENTS.filter((a) => s[a.metric] >= a.target).map((a) => a.id);
}

/** Earned ids that are not unlocked yet (definition order). */
export function newlyEarned(s: ProgressSnapshot, unlocked: ReadonlySet<string>): string[] {
  return evaluateAchievements(s).filter((id) => !unlocked.has(id));
}

/** Progress toward one achievement, clamped to the target. */
export function achievementProgress(a: AchievementDef, s: ProgressSnapshot): { value: number; target: number; ratio: number } {
  const value = Math.max(0, Math.min(a.target, s[a.metric]));
  return { value, target: a.target, ratio: a.target > 0 ? value / a.target : 1 };
}

/** Longest run of consecutive YYYY-MM-DD keys. */
export function longestDayRun(dateKeys: Iterable<string>): number {
  const set = new Set(dateKeys);
  let best = 0;
  for (const key of set) {
    if (set.has(addDays(key, -1))) continue; // not the start of a run
    let n = 1;
    let cursor = addDays(key, 1);
    while (set.has(cursor)) {
      n++;
      cursor = addDays(cursor, 1);
    }
    best = Math.max(best, n);
  }
  return best;
}

/** Rated puzzles needed before the rating counts for achievements. */
export const ESTABLISHED_AFTER = 10;

export interface SnapshotInput {
  attempts: readonly Pick<Attempt, 'mode' | 'solved'>[];
  rushRuns: readonly Pick<RushRun, 'score' | 'bestCombo'>[];
  battles: readonly Pick<BattleRecord, 'result'>[];
  daily: readonly Pick<DailyRecord, 'date' | 'solved'>[];
  puzzleRating: number;
  puzzleStreak: StreakState;
  customCount: number;
}

export function buildSnapshot(i: SnapshotInput): ProgressSnapshot {
  let solvedTotal = 0;
  let ratedCount = 0;
  let themeSolved = 0;
  let reviewSolved = 0;
  for (const a of i.attempts) {
    if (a.mode === 'rated') ratedCount++;
    if (!a.solved) continue;
    solvedTotal++;
    if (a.mode === 'theme') themeSolved++;
    else if (a.mode === 'review') reviewSolved++;
  }
  const solvedDays = i.daily.filter((d) => d.solved).map((d) => d.date);
  return {
    solvedTotal,
    ratedCount,
    establishedRating: ratedCount >= ESTABLISHED_AFTER ? Math.round(i.puzzleRating) : 0,
    bestStreak: i.puzzleStreak.best,
    dailySolved: solvedDays.length,
    dailyBestStreak: longestDayRun(solvedDays),
    rushBest: i.rushRuns.reduce((m, r) => Math.max(m, r.score), 0),
    rushBestCombo: i.rushRuns.reduce((m, r) => Math.max(m, r.bestCombo), 0),
    battleWins: i.battles.filter((b) => b.result === 'win').length,
    themeSolved,
    reviewSolved,
    customCreated: i.customCount,
  };
}
