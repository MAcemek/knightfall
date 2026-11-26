import type { BulletWeek } from './stopRules.ts';
import type { TodayData } from './todayStore.ts';
import { weekInfo } from './planLogic.ts';
import { WEEK_DAYS } from './adaptLogic.ts';
import type { Task, TaskId } from './todayLogic.ts';

/** Wording for the Today page and the Home strip. No React. */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "5 minutes ago" for a time in ms, or a line for never. */
export function agoText(at: number | null, now: number): string {
  if (at === null || !Number.isFinite(at)) return 'Not synced yet';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return 'Synced just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `Synced ${plural(m, 'minute', 'minutes')} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Synced ${plural(h, 'hour', 'hours')} ago`;
  return `Synced ${plural(Math.floor(h / 24), 'day', 'days')} ago`;
}

/** What the bullet card says under its count. */
export function bulletLine(w: BulletWeek): string {
  if (w.count > w.limit) return `Over the limit by ${w.count - w.limit}. No more bullet this week.`;
  if (w.state === 'full') return 'Limit reached. No more bullet this week.';
  if (w.state === 'near') return `Close to the limit. ${plural(w.limit - w.count, 'game', 'games')} left this week.`;
  return 'Within the limit.';
}

/** The start line of a plan that has not begun. */
export function startsLine(daysToGo: number, startDate: string): string {
  if (daysToGo <= 1) return `Your plan starts tomorrow, on ${startDate}.`;
  return `Your plan starts in ${daysToGo} days, on ${startDate}.`;
}

/** The one line of the Home strip. */
export function stripText(data: Pick<TodayData, 'plan' | 'summary' | 'today'>): string {
  if (!data.plan) return '';
  const w = weekInfo(data.plan.startDate, data.today);
  if (w.state === 'before') return `Coach: your plan starts in ${plural(-w.offset, 'day', 'days')}`;
  if (w.state === 'after') return 'Coach: the 12 weeks are done';
  return `Coach: ${data.summary.done} of ${data.summary.total} done today, week ${w.week}`;
}

const WHY: Record<TaskId, string> = {
  wood: 'Repeating the same puzzles makes the patterns automatic.',
  rush: 'A quick run warms up your eye for tactics.',
  check: 'Asking whether the last move is safe stops one-move blunders.',
  study: 'A little study each day keeps the basics fresh.',
  daily: 'A check on every move is the habit that wins slow games.',
  rapid: 'Slow games show how you really think.',
  review: 'Finding your own mistakes first makes the engine more useful.',
  missed: 'The tactics you missed are the best puzzles for you.',
  blitz: 'Only worth it when you feel fresh.',
};

/** Why a task is on the list: one short line. The focus task already says it in its detail. */
export function taskWhy(t: Pick<Task, 'id' | 'detail'>): string {
  return t.id === 'focus' ? t.detail : WHY[t.id];
}

/** "3 of 7 days active", the line of the week card. */
export function weekLine(days: number): string {
  const n = Math.max(0, Math.min(WEEK_DAYS, Math.round(days)));
  return `${n} of ${WEEK_DAYS} days active`;
}

export type StripView =
  | { kind: 'none' }
  | { kind: 'plain'; text: string }
  | { kind: 'next'; title: string; sub: string; to: string }
  | { kind: 'done'; text: string };

/** What the Home strip shows. Before and after the plan it is one line, during it the next task with a button. */
export function homeStrip(data: Pick<TodayData, 'plan' | 'summary' | 'today' | 'next'>): StripView {
  if (!data.plan) return { kind: 'none' };
  const w = weekInfo(data.plan.startDate, data.today);
  if (w.state !== 'running') return { kind: 'plain', text: stripText(data) };
  const sub = `${data.summary.done} of ${data.summary.total} done today`;
  if (!data.next) return { kind: 'done', text: `Coach: all ${data.summary.total} tasks done today.` };
  return { kind: 'next', title: data.next.title, sub, to: data.next.to };
}
