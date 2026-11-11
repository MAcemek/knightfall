import type { Attempt, BattleRecord, RushMode, RushRun } from '../../shared/db.ts';
import { LOW_PRIORITY_THEMES } from '../../shared/themes.ts';

/** Pure aggregation for the Stats page (no React, no IndexedDB). */

export interface RatingPoint {
  at: number;
  rating: number;
}

/**
 * Puzzle rating over time from rated attempts (oldest first). Long histories are thinned to at most
 * `maxPoints` by keeping the last point of each equal-sized chunk, so the newest point always survives.
 */
export function ratingSeries(attempts: readonly Pick<Attempt, 'mode' | 'ratingAfter' | 'at'>[], maxPoints = 120): RatingPoint[] {
  const pts = attempts
    .filter((a) => a.mode === 'rated' && typeof a.ratingAfter === 'number')
    .map((a) => ({ at: a.at, rating: a.ratingAfter as number }))
    .sort((a, b) => a.at - b.at);
  if (pts.length <= maxPoints) return pts;
  const size = pts.length / maxPoints;
  const out: RatingPoint[] = [];
  for (let i = 1; i <= maxPoints; i++) out.push(pts[Math.min(pts.length - 1, Math.ceil(i * size) - 1)]);
  return out;
}

export interface ThemeStat {
  theme: string;
  attempts: number;
  solved: number;
  /** 0..1 */
  accuracy: number;
}

/** Tags that are too generic to be a strength or a weakness. */
const SKIP_THEMES: ReadonlySet<string> = new Set([...LOW_PRIORITY_THEMES, 'mate']);

/** Accuracy per theme, best first (ties: more attempts first). Themes with fewer than `minAttempts` are dropped. */
export function themeAccuracy(rows: readonly { themes: readonly string[]; solved: boolean }[], minAttempts = 5): ThemeStat[] {
  const acc = new Map<string, { attempts: number; solved: number }>();
  for (const r of rows) {
    for (const t of new Set(r.themes)) {
      if (SKIP_THEMES.has(t)) continue;
      const cur = acc.get(t) ?? { attempts: 0, solved: 0 };
      cur.attempts++;
      if (r.solved) cur.solved++;
      acc.set(t, cur);
    }
  }
  return [...acc.entries()]
    .filter(([, v]) => v.attempts >= minAttempts)
    .map(([theme, v]) => ({ theme, attempts: v.attempts, solved: v.solved, accuracy: v.solved / v.attempts }))
    .sort((a, b) => b.accuracy - a.accuracy || b.attempts - a.attempts || a.theme.localeCompare(b.theme));
}

/** Top `n` and bottom `n` themes (no overlap; weaknesses are worst first). */
export function strengthsAndWeaknesses(stats: readonly ThemeStat[], n = 3): { strengths: ThemeStat[]; weaknesses: ThemeStat[] } {
  const strengths = stats.slice(0, n);
  const rest = stats.slice(strengths.length);
  return { strengths, weaknesses: rest.slice(-n).reverse() };
}

/** YYYY-MM-DD in the device's local time zone. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export function heatLevel(count: number): HeatLevel {
  if (count <= 0) return 0;
  if (count < 5) return 1;
  if (count < 15) return 2;
  if (count < 30) return 3;
  return 4;
}

export interface DayCell {
  date: string;
  count: number;
  level: HeatLevel;
}

/**
 * Activity heatmap: `weeks` columns, oldest first, each a Monday→Sunday array of 7 cells.
 * The last column is the week containing `today`; days after today are null.
 */
export function activityGrid(timestamps: readonly number[], today: Date, weeks = 18): (DayCell | null)[][] {
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const k = localDateKey(new Date(ts));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const todayKey = localDateKey(today);
  // Noon avoids daylight-saving edge cases when stepping whole days.
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const mondayOffset = (cursor.getDay() + 6) % 7; // 0 = Monday
  cursor.setDate(cursor.getDate() - mondayOffset - (weeks - 1) * 7);
  const grid: (DayCell | null)[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: (DayCell | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const key = localDateKey(cursor);
      const count = counts.get(key) ?? 0;
      col.push(key > todayKey ? null : { date: key, count, level: heatLevel(count) });
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.push(col);
  }
  return grid;
}

/** Number of days (ending today, or yesterday if today is empty) with at least one puzzle. */
export function activeDayStreak(timestamps: readonly number[], today: Date): number {
  const days = new Set(timestamps.map((ts) => localDateKey(new Date(ts))));
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (days.has(localDateKey(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export interface Totals {
  attempted: number;
  solved: number;
  /** 0..1, null when nothing was attempted. */
  accuracy: number | null;
  timeMs: number;
}

export function totals(attempts: readonly Pick<Attempt, 'solved' | 'timeMs'>[]): Totals {
  const solved = attempts.filter((a) => a.solved).length;
  return {
    attempted: attempts.length,
    solved,
    accuracy: attempts.length ? solved / attempts.length : null,
    timeMs: attempts.reduce((s, a) => s + (a.timeMs || 0), 0),
  };
}

export interface RushBest {
  best: number;
  runs: number;
  bestCombo: number;
  highestRating: number;
}

const RUSH_MODE_IDS: readonly RushMode[] = ['3min', '5min', 'survival'];

export function rushBests(runs: readonly Pick<RushRun, 'mode' | 'score' | 'bestCombo' | 'highestRating'>[]): Record<RushMode, RushBest> {
  const out = Object.fromEntries(RUSH_MODE_IDS.map((m) => [m, { best: 0, runs: 0, bestCombo: 0, highestRating: 0 }])) as Record<RushMode, RushBest>;
  for (const r of runs) {
    const b = out[r.mode];
    if (!b) continue;
    b.runs++;
    b.best = Math.max(b.best, r.score);
    b.bestCombo = Math.max(b.bestCombo, r.bestCombo);
    b.highestRating = Math.max(b.highestRating, r.highestRating);
  }
  return out;
}

export interface BattleSummary {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** 0..1, null when nothing was played. */
  winRate: number | null;
  /** Highest rating ever reached after a battle (null when nothing was played). */
  peak: number | null;
}

export function battleSummary(battles: readonly Pick<BattleRecord, 'result' | 'ratingAfter'>[]): BattleSummary {
  const wins = battles.filter((b) => b.result === 'win').length;
  const losses = battles.filter((b) => b.result === 'loss').length;
  return {
    played: battles.length,
    wins,
    losses,
    draws: battles.length - wins - losses,
    winRate: battles.length ? wins / battles.length : null,
    peak: battles.length ? Math.max(...battles.map((b) => b.ratingAfter)) : null,
  };
}

export interface ChartGeometry {
  /** SVG path for the line ("M x y L x y …"). Empty when there are no points. */
  line: string;
  /** Closed path under the line, down to the bottom padding edge. */
  area: string;
  /** Pixel position of every point (same order as the input). */
  xy: { x: number; y: number }[];
  /** Value range drawn (padded and rounded to 50s). */
  min: number;
  max: number;
}

/** Map a series onto a w×h box with `pad` px on every side. X is by index (even spacing), Y by value. */
export function chartGeometry(values: readonly number[], w: number, h: number, pad: number): ChartGeometry {
  if (!values.length) return { line: '', area: '', xy: [], min: 0, max: 0 };
  const lo = Math.floor((Math.min(...values) - 25) / 50) * 50;
  const hi = Math.ceil((Math.max(...values) + 25) / 50) * 50;
  const span = hi - lo || 1;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const xy = values.map((v, i) => ({
    x: Math.round((pad + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW)) * 100) / 100,
    y: Math.round((pad + (1 - (v - lo) / span) * innerH) * 100) / 100,
  }));
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  const area = `${line} L${xy[xy.length - 1].x} ${h - pad} L${xy[0].x} ${h - pad} Z`;
  return { line, area, xy, min: lo, max: hi };
}

/** "2h 05m", "12m", "45s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
