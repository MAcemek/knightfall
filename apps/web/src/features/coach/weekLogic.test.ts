import { describe, expect, it } from 'vitest';
import { addDays } from '@knightfall/core';
import { emptyBaselines, emptyTargets, PLAN_DAYS, weekInfo } from './planLogic.ts';
import { EMPTY_ACTIVITY } from './stopRules.ts';
import { defaultWeek, nextFocus, planWeekRange, shiftWeek, summarizeWeek, weekDays, weekLabel, weekNumber, type GameWeek, type WeekGame, type WeekInput } from './weekLogic.ts';

const local = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h, 0, 0).getTime();
const MON = '2026-11-16';
const SUN = '2026-11-22';

const plan = { username: '', startDate: '2026-11-02', baselines: emptyBaselines(), targets: emptyTargets() };
const input = (over: Partial<WeekInput> = {}): WeekInput => ({
  weekFirst: MON, today: SUN, plan, woodAttempts: [], woodFinishedAt: [], rushRuns: [], checkTotals: { days: {} }, games: [], reviews: [], days: [], activity: { ...EMPTY_ACTIVITY, games: [] }, ratings: [], ...over,
});
const game = (over: Partial<WeekGame> = {}): WeekGame => ({ playedAt: local(2026, 11, 21), source: 'chesscom', speed: 'rapid', side: 'w', blunders: null, clock: null, ...over });

describe('weeks of the plan', () => {
  const start = '2026-11-04'; // a Wednesday
  const range = planWeekRange(start);
  it('runs from the plan start to the first day of week 12', () => {
    expect(range.first).toBe('2026-11-04');
    expect(range.last).toBe('2027-01-20');
  });
  it('starts on this plan week and stays inside the plan', () => {
    expect(defaultWeek(range, '2026-11-18')).toBe('2026-11-18');
    expect(defaultWeek(range, '2026-11-17')).toBe('2026-11-11');
    expect(defaultWeek(range, '2026-10-01')).toBe(range.first);
    expect(defaultWeek(range, '2028-01-01')).toBe(range.last);
  });
  it('steps by whole weeks and stops at both ends', () => {
    expect(shiftWeek('2026-11-18', -1, range)).toBe('2026-11-11');
    expect(shiftWeek('2026-11-04', -1, range)).toBe('2026-11-04');
    expect(shiftWeek(range.last, 1, range)).toBe(range.last);
  });
  it('numbers and labels a week', () => {
    expect(weekNumber('2026-11-18', range)).toBe(3);
    expect(weekLabel('2026-11-18')).toBe('18 Nov to 24 Nov');
    expect(weekDays(MON)).toHaveLength(7);
    expect(weekDays(MON)[6]).toBe(SUN);
  });
  it('gives every day of the plan the same week number as the Today page, from 1 to 12', () => {
    for (let d = 0; d < PLAN_DAYS; d++) {
      const day = addDays(start, d);
      expect(weekNumber(defaultWeek(range, day), range)).toBe(weekInfo(start, day).week);
    }
    expect(weekNumber(defaultWeek(range, addDays(start, PLAN_DAYS - 1)), range)).toBe(12);
    expect(weekNumber(range.last, range)).toBe(12);
  });
});

describe('days active and task days', () => {
  it('counts a day once however many tasks were done, and each task by its own days', () => {
    const s = summarizeWeek(
      input({
        rushRuns: [{ at: local(2026, 11, 16, 9), score: 8 }, { at: local(2026, 11, 16, 10), score: 12 }, { at: local(2026, 11, 17), score: 5 }],
        checkTotals: { days: { '2026-11-16': { correct: 8, wrongReason: 1, missed: 1, falseAlarms: 0 }, '2026-11-18': { correct: 3, wrongReason: 0, missed: 0, falseAlarms: 0 } } },
        days: [{ date: '2026-11-19', ticks: ['daily', 'bogus'], blitz: [] }],
      }),
    );
    expect(s.daysActive).toBe(3);
    const by = Object.fromEntries(s.kinds.map((k) => [k.id, k]));
    expect(by.rush.done).toBe(2);
    expect(by.check.done).toBe(1);
    expect(by.daily.done).toBe(1);
    expect(by.wood.done).toBe(0);
    expect(by.rush.planned).toBe(5);
    expect(by.rapid.planned).toBe(2);
  });
  it('counts Woodpecker by minutes or a finished cycle, and ignores days after today', () => {
    const s = summarizeWeek(
      input({
        today: '2026-11-17',
        woodAttempts: [{ at: local(2026, 11, 16), solved: true, timeMs: 26 * 60_000 }, { at: local(2026, 11, 17), solved: false, timeMs: 60_000 }],
        woodFinishedAt: [local(2026, 11, 18)],
      }),
    );
    expect(s.kinds.find((k) => k.id === 'wood')).toMatchObject({ done: 1, planned: 2 });
  });
  it('does not plan tasks before the plan starts', () => {
    const s = summarizeWeek(input({ plan: { ...plan, startDate: '2026-11-19' } }));
    expect(s.kinds.find((k) => k.id === 'rush')?.planned).toBe(2);
  });
  it('counts a rapid day from two games and a review day from a review per game', () => {
    const s = summarizeWeek(input({ games: [game({ playedAt: local(2026, 11, 21, 10) }), game({ playedAt: local(2026, 11, 21, 11) })], reviews: [{ at: local(2026, 11, 21), skipped: false }, { at: local(2026, 11, 21, 13), skipped: false }, { at: local(2026, 11, 22), skipped: true }] }));
    expect(s.kinds.find((k) => k.id === 'rapid')?.done).toBe(1);
    expect(s.kinds.find((k) => k.id === 'review')?.done).toBe(1);
    expect(s.games.reviews).toBe(2);
  });
});

describe('the adapted list', () => {
  const kindOf = (s: ReturnType<typeof summarizeWeek>, id: string) => s.kinds.find((k) => k.id === id);
  it('counts the focus task on weekdays, by theme attempts of the day', () => {
    const attempts = (day: number, n: number) => Array.from({ length: n }, () => ({ at: local(2026, 11, day), themes: ['fork', 'short'] }));
    const s = summarizeWeek(input({ focusTheme: 'fork', themeAttempts: [...attempts(16, 10), ...attempts(17, 9), ...attempts(18, 10).map((a) => ({ ...a, themes: ['pin'] }))] }));
    expect(kindOf(s, 'focus')).toMatchObject({ done: 1, planned: 5, to: '/train/theme/fork' });
    expect(s.daysActive).toBe(1);
  });
  it('has no focus row without a focus theme', () => {
    expect(kindOf(summarizeWeek(input()), 'focus')).toBeUndefined();
  });
  it('uses the adapted blunder check target', () => {
    const checkTotals = { days: { '2026-11-17': { correct: 12, wrongReason: 0, missed: 0, falseAlarms: 0 } } };
    expect(kindOf(summarizeWeek(input({ checkTotals })), 'check')?.done).toBe(1);
    expect(kindOf(summarizeWeek(input({ checkTotals, checkTarget: 20 })), 'check')?.done).toBe(0);
  });
  it('counts a ticked review when reviews are not counted by the app', () => {
    const s = summarizeWeek(input({ days: [{ date: '2026-11-21', ticks: ['review'], blitz: [] }] }));
    expect(kindOf(s, 'review')).toMatchObject({ done: 1, planned: 2 });
  });
  it('counts only days inside the plan', () => {
    const rushRuns = [local(2026, 11, 2), local(2026, 11, 3), local(2026, 11, 4)].map((at) => ({ at, score: 5 }));
    const first = summarizeWeek(input({ weekFirst: '2026-11-02', plan: { ...plan, startDate: '2026-11-04' }, rushRuns }));
    expect(kindOf(first, 'rush')).toMatchObject({ done: 1, planned: 3 });
    expect(first.daysActive).toBe(1);
    const last = summarizeWeek(input({ weekFirst: '2027-01-25', today: '2027-01-31', plan: { ...plan, startDate: '2026-11-04' }, rushRuns: [local(2027, 1, 26), local(2027, 1, 28)].map((at) => ({ at, score: 5 })) }));
    expect(kindOf(last, 'rush')).toMatchObject({ done: 1, planned: 2 });
    expect(last.daysActive).toBe(1);
  });
});

describe('puzzles', () => {
  it('sums Woodpecker, Rush and the blunder check', () => {
    const s = summarizeWeek(
      input({
        woodAttempts: [1, 2, 3, 4].map((n) => ({ at: local(2026, 11, 17), solved: n < 4, timeMs: 1000 })),
        rushRuns: [{ at: local(2026, 11, 17), score: 9 }, { at: local(2026, 11, 18), score: 14 }],
        checkTotals: { days: { '2026-11-17': { correct: 6, wrongReason: 2, missed: 1, falseAlarms: 1 }, '2026-11-09': { correct: 10, wrongReason: 0, missed: 0, falseAlarms: 0 } } },
      }),
    ).puzzles;
    expect(s).toMatchObject({ woodDone: 4, woodAccuracy: 0.75, rushRuns: 2, rushBest: 14, checkTotal: 10, checkRight: 0.6 });
  });
  it('has no percentages without work', () => {
    expect(summarizeWeek(input()).puzzles).toMatchObject({ woodAccuracy: null, rushBest: null, checkRight: null });
  });
});

describe('games', () => {
  it('keeps bot games apart and averages blunders over analysed rapid games', () => {
    const g = summarizeWeek(input({ games: [game({ blunders: 3 }), game({ blunders: 1 }), game({ blunders: null }), game({ source: 'bot', blunders: 9 }), game({ speed: 'blitz', blunders: 9 }), game({ side: null })] })).games;
    expect(g.rapid).toBe(3);
    expect(g.bot).toBe(1);
    expect(g.analysed).toBe(2);
    expect(g.blundersPerGame).toBe(2);
  });
  it('counts bullet games in the week against the limit and blitz stop days', () => {
    const at = (d: number, h: number) => local(2026, 11, d, h);
    const games = [
      ...[10, 11, 12].map((h) => ({ key: `b${h}`, at: at(17, h), speed: 'bullet' as const, result: 'win' as const })),
      { key: 'old', at: at(10, 9), speed: 'bullet' as const, result: 'loss' as const },
      { key: 'l1', at: at(18, 10), speed: 'blitz' as const, result: 'loss' as const },
      { key: 'l2', at: at(18, 11), speed: 'blitz' as const, result: 'loss' as const },
      { key: 'w1', at: at(19, 10), speed: 'blitz' as const, result: 'loss' as const },
      { key: 'w2', at: at(19, 11), speed: 'blitz' as const, result: 'win' as const },
    ];
    const g = summarizeWeek(input({ activity: { user: 'x', lastSync: local(2026, 11, 22), games } })).games;
    expect(g).toMatchObject({ bullet: 3, bulletLimit: 10, blitzStopDays: 1, fastKnown: true });
  });
  it('says synced games are unknown for an old week', () => {
    const g = summarizeWeek(input({ today: '2027-01-10', activity: { user: 'x', lastSync: local(2027, 1, 10), games: [] } })).games;
    expect(g.fastKnown).toBe(false);
  });
});

describe('ratings', () => {
  const rows = [
    { id: 'a', date: '2026-11-15', site: 'chesscom' as const, speed: 'rapid' as const, rating: 1000 },
    { id: 'b', date: '2026-11-16', site: 'chesscom' as const, speed: 'rapid' as const, rating: 1100 },
    { id: 'c', date: '2026-11-21', site: 'chesscom' as const, speed: 'rapid' as const, rating: 1130 },
    { id: 'd', date: '2026-11-18', site: 'chesscom' as const, speed: 'blitz' as const, rating: 900 },
  ];
  it('gives the change inside the week per speed and the distance to the target line', () => {
    const withTarget = { ...plan, baselines: { ...emptyBaselines(), rapid: 1000 }, targets: { ...emptyTargets(), rapid: { three: 1091, six: null } } };
    const r = summarizeWeek(input({ ratings: rows, plan: withTarget })).ratings;
    expect(r.map((x) => x.speed)).toEqual(['rapid', 'blitz']);
    expect(r[0]).toMatchObject({ first: 1100, last: 1130, change: 30 });
    // Line on 21 Nov: 19 days of 91 from 1000 to 1091 = 1019.
    expect(r[0].fromLine).toBe(1130 - 1019);
    expect(r[1]).toMatchObject({ change: null, fromLine: null });
  });
  it('only counts rows of the plan user', () => {
    const r = summarizeWeek(input({ plan: { ...plan, username: 'me' }, ratings: [{ ...rows[1], user: 'other' }, { ...rows[2], user: 'ME' }] })).ratings;
    expect(r[0]).toMatchObject({ first: 1130, change: null });
  });
});

describe('next week', () => {
  const quiet: GameWeek = { rapid: 0, bot: 0, reviews: 0, analysed: 0, blundersPerGame: null, clock: { share: null, games: 0, state: null }, bullet: 0, bulletLimit: 10, fastKnown: true, blitzStopDays: 0 };
  const kind = (id: 'wood' | 'rush', done: number, planned: number) => ({ id, label: id === 'wood' ? 'Woodpecker' : 'Puzzle Rush', done, planned, to: `/${id}` });
  it('tells the player to start when nothing was done', () => {
    const f = nextFocus({ daysActive: 0, kinds: [], games: quiet });
    expect(f).toHaveLength(1);
    expect(f[0].to).toBe('/train/blunder-check');
  });
  it('names the task done on the fewest days', () => {
    const f = nextFocus({ daysActive: 4, kinds: [kind('wood', 5, 5), kind('rush', 1, 5)], games: quiet });
    expect(f[0].text).toBe('Puzzle Rush was done on 1 of 5 planned days. Do it first on the next one.');
    expect(f[0].to).toBe('/rush');
  });
  it('puts blunders and clock before the weakest task and returns two at most', () => {
    const games: GameWeek = { ...quiet, analysed: 3, blundersPerGame: 2.5, clock: { share: 0.5, games: 3, state: 'low' }, blitzStopDays: 2 };
    const f = nextFocus({ daysActive: 4, kinds: [kind('rush', 0, 5)], games });
    expect(f).toHaveLength(2);
    expect(f[0].text).toContain('2.5 blunders per rapid game');
    expect(f[1].text).toContain('50% of your time');
  });
  it('warns about blunders from 2 a game, like the Today page, and words the bullet limit as "or fewer"', () => {
    const f = nextFocus({ daysActive: 4, kinds: [], games: { ...quiet, analysed: 3, blundersPerGame: 2, bullet: 10 } });
    expect(f[0].text).toContain('2.0 blunders per rapid game');
    expect(f[1].text).toBe('You played 10 bullet games. Keep it to 10 or fewer next week and play rapid instead.');
  });
  it('is content when everything was done', () => {
    expect(nextFocus({ daysActive: 7, kinds: [kind('wood', 5, 5)], games: quiet })[0].text).toBe('Everything planned was done. Keep the same plan next week.');
  });
  it('has no advice for a future or an empty week', () => {
    expect(summarizeWeek(input({ today: '2026-11-10' })).future).toBe(true);
    const empty = summarizeWeek(input());
    expect(empty.empty).toBe(true);
    expect(empty.focus).toEqual([]);
  });
});
