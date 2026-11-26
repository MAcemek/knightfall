import { describe, expect, it } from 'vitest';
import { agoText, bulletLine, homeStrip, startsLine, stripText, taskWhy, weekLine } from './todayText.ts';
import { emptyBaselines, emptyTargets } from './planLogic.ts';

const plan = { username: '', startDate: '2026-03-02', baselines: emptyBaselines(), targets: emptyTargets() };

describe('agoText', () => {
  it('words the age of the last sync', () => {
    expect(agoText(null, 1000)).toBe('Not synced yet');
    expect(agoText(1000, 30_000)).toBe('Synced just now');
    expect(agoText(0, 60_000)).toBe('Synced 1 minute ago');
    expect(agoText(0, 5 * 3_600_000)).toBe('Synced 5 hours ago');
    expect(agoText(0, 3 * 86_400_000)).toBe('Synced 3 days ago');
  });
});

describe('bulletLine', () => {
  it('says how close the limit is', () => {
    expect(bulletLine({ count: 3, limit: 10, state: 'ok' })).toBe('Within the limit.');
    expect(bulletLine({ count: 9, limit: 10, state: 'near' })).toContain('1 game left');
    expect(bulletLine({ count: 10, limit: 10, state: 'full' })).toContain('Limit reached');
    expect(bulletLine({ count: 12, limit: 10, state: 'full' })).toContain('Over the limit by 2');
  });
});

describe('startsLine and stripText', () => {
  it('words the days before the start', () => {
    expect(startsLine(1, '2026-03-02')).toContain('tomorrow');
    expect(startsLine(4, '2026-03-02')).toContain('in 4 days');
  });
  it('words the three states of the plan', () => {
    const summary = { done: 3, total: 5 };
    expect(stripText({ plan, summary, today: '2026-03-10' })).toBe('Coach: 3 of 5 done today, week 2');
    expect(stripText({ plan, summary, today: '2026-02-27' })).toBe('Coach: your plan starts in 3 days');
    expect(stripText({ plan, summary, today: '2026-08-01' })).toBe('Coach: the 12 weeks are done');
    expect(stripText({ plan: null, summary, today: '2026-03-10' })).toBe('');
  });
});

describe('taskWhy and weekLine', () => {
  it('gives every task a reason, and the focus task its own', () => {
    for (const id of ['wood', 'rush', 'check', 'study', 'daily', 'rapid', 'review', 'missed', 'blitz'] as const) expect(taskWhy({ id, detail: 'x' }).length).toBeGreaterThan(10);
    expect(taskWhy({ id: 'focus', detail: 'You solve 42% of fork puzzles' })).toBe('You solve 42% of fork puzzles');
  });
  it('words the days active', () => {
    expect(weekLine(3)).toBe('3 of 7 days active');
    expect(weekLine(0)).toBe('0 of 7 days active');
    expect(weekLine(12)).toBe('7 of 7 days active');
  });
});

describe('homeStrip', () => {
  const next = { id: 'wood' as const, title: 'Woodpecker', detail: '', minutes: 25, to: '/train/woodpecker', kind: 'auto' as const };
  const summary = { done: 2, total: 5 };
  it('is empty without a plan', () => {
    expect(homeStrip({ plan: null, summary, today: '2026-03-10', next })).toEqual({ kind: 'none' });
  });
  it('shows the next task during the plan', () => {
    expect(homeStrip({ plan, summary, today: '2026-03-10', next })).toEqual({ kind: 'next', title: 'Woodpecker', sub: '2 of 5 done today', to: '/train/woodpecker' });
  });
  it('says all done, and keeps one line before and after the plan', () => {
    expect(homeStrip({ plan, summary: { done: 5, total: 5 }, today: '2026-03-10', next: null })).toEqual({ kind: 'done', text: 'Coach: all 5 tasks done today.' });
    expect(homeStrip({ plan, summary, today: '2026-02-27', next })).toEqual({ kind: 'plain', text: 'Coach: your plan starts in 3 days' });
    expect(homeStrip({ plan, summary, today: '2026-08-01', next })).toEqual({ kind: 'plain', text: 'Coach: the 12 weeks are done' });
  });
});
