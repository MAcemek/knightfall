import { isTrainableTheme, themeLabel } from '../../shared/themes.ts';
import { motifSummary, MIN_INSIGHT_GAMES } from '../analysis/insights/insightsLogic.ts';
import { weakThemes } from '../train/weakLogic.ts';
import type { Pace } from '../woodpecker/woodLogic.ts';
import { CLOCK_LOW, type ClockStat } from './progressLogic.ts';
import type { Task } from './todayLogic.ts';

/** How the daily list adapts to what the player has done so far. Pure: no React, no storage. */

/* ---------- focus theme ---------- */

/** Puzzles of the focus theme that tick the task. */
export const FOCUS_TARGET = 10;
/** A mistake motif counts once it happened this many times. */
export const MIN_MOTIF_COUNT = 2;

export interface ThemeRow {
  themes: readonly string[];
  solved: boolean;
}

export interface MotifCount {
  label: string;
  /** Train theme that practises it, or null. */
  theme: string | null;
  count: number;
  games: number;
}

export interface Focus {
  theme: string;
  source: 'mistakes' | 'weak';
  /** One short line: where the focus comes from. */
  reason: string;
}

/**
 * The theme to practise today. With 3 or more reviewed games the most frequent mistake motif that has a Train theme wins,
 * because it comes from real games. Otherwise the puzzle theme solved least often (5 tries or more). Null with no data.
 */
export function pickFocus(rows: readonly ThemeRow[], motifs: readonly MotifCount[], reviewedGames: number): Focus | null {
  if (reviewedGames >= MIN_INSIGHT_GAMES) {
    const best = motifs
      .filter((m) => m.theme !== null && isTrainableTheme(m.theme) && m.count >= MIN_MOTIF_COUNT)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];
    if (best?.theme) return { theme: best.theme, source: 'mistakes', reason: `${best.label}: ${motifSummary(best.count, best.games)}` };
  }
  const weak = weakThemes(rows)[0];
  if (weak) {
    const pct = Math.round((weak.solved / weak.attempts) * 100);
    return { theme: weak.theme, source: 'weak', reason: `You solve ${pct}% of ${themeLabel(weak.theme).toLowerCase()} puzzles` };
  }
  return null;
}

export function focusTask(focus: Focus): Task {
  return {
    id: 'focus',
    title: `Focus: ${themeLabel(focus.theme)}, ${FOCUS_TARGET} puzzles`,
    detail: focus.reason,
    minutes: 5,
    to: `/train/theme/${focus.theme}`,
    kind: 'auto',
  };
}

/** How many attempts of the focus theme were made in the theme trainer. */
export function countFocusAttempts(rows: readonly { mode: string; themes?: readonly string[] }[], theme: string): number {
  let n = 0;
  for (const r of rows) if (r.mode === 'theme' && r.themes?.includes(theme)) n++;
  return n;
}

/* ---------- Woodpecker ---------- */

export const WOOD_AHEAD_MINUTES = 15;
const SPLIT_DAYS = 3;

export type WoodAdvice =
  | { kind: 'behind'; /** Puzzles missing from earlier days. */ behind: number; today: number; extra: number; days: number }
  | { kind: 'ahead'; by: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Advice from the pace of the running cycle. Behind by more than one day's quota: how many to catch up, split over the next days.
 * Ahead: say so. Null when on pace, past the target or done.
 */
export function woodAdvice(p: Pace, total: number): WoodAdvice | null {
  if (total <= 0) return null;
  const daily = Math.max(1, Math.ceil(total / Math.max(1, p.targetDays)));
  if (p.state === 'ahead') return { kind: 'ahead', by: Math.max(1, p.done - p.expectedDone) };
  if (p.state !== 'behind') return null;
  // Earlier days only: puzzles done today must not shrink the backlog while the player works through today's quota.
  const behind = p.expectedDone - daily - (p.done - p.doneToday);
  if (behind <= daily) return null;
  const days = Math.max(1, Math.min(SPLIT_DAYS, p.targetDays - p.dayIndex));
  return { kind: 'behind', behind, today: daily, extra: Math.ceil(behind / days), days };
}

export function woodAdviceText(a: WoodAdvice): string {
  if (a.kind === 'ahead') return `Ahead of pace by ${plural(a.by, 'puzzle', 'puzzles')}. ${WOOD_AHEAD_MINUTES} minutes is enough today.`;
  const then = a.days === 1 ? `add ${a.extra} tomorrow` : `add ${a.extra} a day for the next ${a.days} days`;
  return `You are ${plural(a.behind, 'puzzle', 'puzzles')} behind pace. Do about ${a.today} today, then ${then}.`;
}

/* ---------- blunder check and clock ---------- */

export const CHECK_NORMAL = 10;
export const CHECK_HARD = 20;
/** Blunders per game, averaged over the newest analysed rapid games, that double the blunder check. */
export const BLUNDER_HIGH = 2;
const MIN_BLUNDER_GAMES = 3;

/** 20 positions when the newest analysed rapid games average 2 or more blunders (with at least 3 games), else 10. */
export function checkTarget(avgBlunders: number | null, games: number): number {
  return avgBlunders !== null && games >= MIN_BLUNDER_GAMES && avgBlunders >= BLUNDER_HIGH ? CHECK_HARD : CHECK_NORMAL;
}

/** The clock line for the rapid task, or null when the share of the clock used is not low. */
export function clockNote(stat: Pick<ClockStat, 'share' | 'state'>): string | null {
  if (stat.state !== 'low') return null;
  const used = stat.share !== null ? ` You used ${Math.round(stat.share * 100)}% lately.` : '';
  return `Use at least ${Math.round(CLOCK_LOW * 100)}% of your clock.${used}`;
}

/* ---------- applying it all ---------- */

export interface Adapt {
  focus: Focus | null;
  wood: WoodAdvice | null;
  checkTarget: number;
  clock: string | null;
  /** The "Review it yourself first" setting is on, so reviews are written and can be counted. */
  selfReview: boolean;
}

export const NO_ADAPT: Adapt = { focus: null, wood: null, checkTarget: CHECK_NORMAL, clock: null, selfReview: true };

/** The day's tasks with the adaptations applied. Returns new objects. */
export function adaptTasks(tasks: readonly Task[], a: Adapt): Task[] {
  const out: Task[] = [];
  for (const base of tasks) {
    const t: Task = { ...base };
    if (t.id === 'wood' && a.wood) {
      t.detail = woodAdviceText(a.wood);
      if (a.wood.kind === 'ahead') t.minutes = WOOD_AHEAD_MINUTES;
    } else if (t.id === 'check' && a.checkTarget !== CHECK_NORMAL) {
      t.title = `Blunder check, ${a.checkTarget} positions`;
      t.detail = `Your last games had many blunders, so the target is higher. ${t.detail}`;
      t.minutes = Math.round((t.minutes * a.checkTarget) / CHECK_NORMAL);
    } else if (t.id === 'rapid' && a.clock) {
      t.detail = `${t.detail} ${a.clock}`;
    } else if (t.id === 'review' && !a.selfReview) {
      t.kind = 'manual';
      t.detail = 'Turn on "Review it yourself first" in Settings to have this counted. Until then, tick it yourself.';
    }
    out.push(t);
    if (t.id === 'check' && a.focus) out.push(focusTask(a.focus));
  }
  return out;
}

/* ---------- this week ---------- */

/** Days in the week line ("3 of 7 days active"). The count itself is weekActivity in weekLogic.ts. */
export const WEEK_DAYS = 7;
