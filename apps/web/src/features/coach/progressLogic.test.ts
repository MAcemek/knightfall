import { describe, expect, it } from 'vitest';
import type { Puzzle } from '@knightfall/core';
import type { RatingLogRow } from '../../shared/db.ts';
import { sanitizePlan } from './planLogic.ts';
import {
  blundersPerGame, clockShare, gameClockShare, newestSet, parseTimeControl, ratingDelta, ratingSeries, targetLine, woodTimes, type ClockRow,
} from './progressLogic.ts';

const row = (speed: RatingLogRow['speed'], date: string, rating: number): RatingLogRow => ({ id: `chesscom-${speed}-${date}`, date, site: 'chesscom', speed, rating });

describe('ratingSeries', () => {
  it('keeps one speed, one point a day, oldest first, and skips damaged rows', () => {
    const rows = [row('rapid', '2026-11-05', 1520), row('blitz', '2026-11-04', 1400), row('rapid', '2026-11-02', 1500), row('rapid', '2026-11-05', 1530), { ...row('rapid', 'bad', 1), date: 'bad' }, row('rapid', '2026-11-06', Number.NaN)];
    expect(ratingSeries(rows, 'rapid')).toEqual([
      { date: '2026-11-02', rating: 1500 },
      { date: '2026-11-05', rating: 1530 },
    ]);
    expect(ratingSeries([], 'rapid')).toEqual([]);
  });

  it('keeps only the given account, case-insensitive; rows without a user match', () => {
    const rows = [
      { ...row('rapid', '2026-11-01', 1400), user: 'dave' },
      { ...row('rapid', '2026-11-02', 1800), user: 'someone' },
      row('rapid', '2026-11-03', 1450),
      { ...row('rapid', '2026-11-04', 1500), user: 'dave' },
    ];
    expect(ratingSeries(rows, 'rapid', 'Dave').map((p) => p.date)).toEqual(['2026-11-01', '2026-11-03', '2026-11-04']);
    expect(ratingSeries(rows, 'rapid', 'SOMEONE').map((p) => p.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(ratingSeries(rows, 'rapid').map((p) => p.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(ratingSeries(rows, 'rapid', '').map((p) => p.date)).toHaveLength(4);
  });
});

describe('targetLine', () => {
  const plan = sanitizePlan({
    username: '',
    startDate: '2026-11-02',
    baselines: { rapid: 1500, blitz: 1400, bullet: 1300, daily: null },
    targets: { rapid: { three: 1600, six: 1700 }, blitz: { three: null, six: 1600 }, bullet: { three: 1300, six: null }, daily: { three: null, six: null } },
  })!;
  it('has points at the start, three months and six months', () => {
    const line = targetLine(plan, 'rapid')!;
    expect(line.points).toEqual([
      { date: '2026-11-02', value: 1500 },
      { date: '2027-02-01', value: 1600 },
      { date: '2027-05-03', value: 1700 },
    ]);
  });
  it('goes straight between points and stays flat outside them', () => {
    const line = targetLine(plan, 'rapid')!;
    expect(line.valueAt('2026-11-02')).toBe(1500);
    expect(line.valueAt('2026-10-01')).toBe(1500);
    expect(line.valueAt('2027-02-01')).toBe(1600);
    expect(line.valueAt('2027-05-03')).toBe(1700);
    expect(line.valueAt('2028-01-01')).toBe(1700);
    // 91 days between the first two points, 45 days in: 1500 + 100 * 45 / 91
    expect(line.valueAt('2026-12-17')).toBeCloseTo(1500 + (100 * 45) / 91, 6);
    // 182 - 91 = 91 days between the last two, 30 days in
    expect(line.valueAt('2027-03-03')).toBeCloseTo(1600 + (100 * 30) / 91, 6);
  });
  it('skips a missing target and gives null without a base or a target', () => {
    expect(targetLine(plan, 'blitz')!.points.map((p) => p.value)).toEqual([1400, 1600]);
    expect(targetLine(plan, 'bullet')!.points.map((p) => p.value)).toEqual([1300, 1300]);
    expect(targetLine(plan, 'daily')).toBeNull();
    expect(targetLine({ ...plan, targets: { ...plan.targets, rapid: { three: null, six: null } } }, 'rapid')).toBeNull();
  });
  it('compares the newest rating with the line on its day', () => {
    const line = targetLine(plan, 'rapid')!;
    const d = ratingDelta([{ date: '2026-11-02', rating: 1500 }, { date: '2027-02-01', rating: 1580 }], line)!;
    expect(d).toMatchObject({ date: '2027-02-01', rating: 1580, target: 1600, delta: -20 });
    expect(ratingDelta([], line)).toBeNull();
    expect(ratingDelta([{ date: '2026-11-02', rating: 1500 }], null)).toBeNull();
  });
});

describe('blundersPerGame', () => {
  const games = (counts: number[]) => counts.map((blunders, i) => ({ playedAt: 1000 - i, blunders }));
  it('averages the newest 10 and the 10 before, and halves the earlier one', () => {
    const rows = games([...Array(10).fill(2), ...Array(10).fill(4), 9]);
    expect(blundersPerGame(rows)).toEqual({ last: 2, previous: 4, goal: 2, games: { last: 10, previous: 10 } });
  });
  it('sorts by date itself', () => {
    const rows = [{ playedAt: 1, blunders: 10 }, { playedAt: 3, blunders: 1 }, { playedAt: 2, blunders: 1 }];
    expect(blundersPerGame(rows).last).toBe(4);
  });
  it('needs 3 earlier games for a comparison', () => {
    expect(blundersPerGame(games([...Array(10).fill(3), 5, 5]))).toEqual({ last: 3, previous: null, goal: null, games: { last: 10, previous: 2 } });
    expect(blundersPerGame(games([...Array(10).fill(3), 5, 5, 5])).previous).toBe(5);
  });
  it('has nothing without games', () => {
    expect(blundersPerGame([])).toEqual({ last: null, previous: null, goal: null, games: { last: 0, previous: 0 } });
  });
});

const clk = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** A game of knight shuffles with a clock after every ply. */
function shuffle(plies: number, clocks: (ply: number) => number, tc = '600'): string {
  const moves = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
  const parts: string[] = [];
  for (let i = 0; i < plies; i++) {
    const num = i % 2 === 0 ? `${i / 2 + 1}. ` : '';
    parts.push(`${num}${moves[i % 4]} {[%clk ${clk(clocks(i))}]}`);
  }
  const head = ['[Event "Live Chess"]', '[Site "Chess.com"]', '[White "Sample"]', '[Black "Other"]', ...(tc ? [`[TimeControl "${tc}"]`] : []), '[Result "*"]'].join('\n');
  return `${head}\n\n${parts.join(' ')} *`;
}

describe('clock use', () => {
  it('reads time controls', () => {
    expect(parseTimeControl('600')).toEqual({ base: 600, inc: 0 });
    expect(parseTimeControl('900+10')).toEqual({ base: 900, inc: 10 });
    expect(parseTimeControl('1/86400')).toBeNull();
    expect(parseTimeControl('-')).toBeNull();
    expect(parseTimeControl(undefined)).toBeNull();
  });
  it('measures how much of the budget the player used', () => {
    // 40 plies, 20 moves each. White ends with 100 s of 600 left: 500 / 600 used.
    const pgn = shuffle(40, (p) => (p >= 38 ? 100_000 : 590_000 - p * 1000));
    expect(gameClockShare({ pgn, side: 'w' })).toBeCloseTo(500 / 600, 6);
  });
  it('adds the increment per own move to the budget', () => {
    // 900+10, 20 own moves: budget 900 + 200 = 1100 s; 300 s left: 800 / 1100 used.
    const pgn = shuffle(40, (p) => (p >= 38 ? 300_000 : 890_000 - p * 1000), '900+10');
    expect(gameClockShare({ pgn, side: 'w' })).toBeCloseTo(800 / 1100, 6);
  });
  it('uses the player side and ignores short games', () => {
    const pgn = shuffle(40, (p) => (p % 2 === 0 ? 400_000 : 50_000));
    expect(gameClockShare({ pgn, side: 'b' })).toBeCloseTo(550 / 600, 6);
    expect(gameClockShare({ pgn, side: 'w' })).toBeCloseTo(200 / 600, 6);
    expect(gameClockShare({ pgn: shuffle(28, () => 300_000), side: 'w' })).toBeNull(); // 14 own moves
  });
  it('skips daily games, games without clocks and other junk', () => {
    expect(gameClockShare({ pgn: shuffle(40, () => 1000, '1/86400'), side: 'w' })).toBeNull();
    expect(gameClockShare({ pgn: shuffle(40, () => 1000, '').replace(/\{[^}]*\}/g, ''), side: 'w', timeControl: '600' })).toBeNull();
    expect(gameClockShare({ pgn: 'nonsense', side: 'w' })).toBeNull();
  });
  it('falls back to the stored time control', () => {
    const pgn = shuffle(40, (p) => (p >= 38 ? 100_000 : 590_000 - p * 1000), '');
    expect(gameClockShare({ pgn, side: 'w' })).toBeNull();
    expect(gameClockShare({ pgn, side: 'w', timeControl: '600' })).toBeCloseTo(500 / 600, 6);
  });
  it('averages the newest games and names the state', () => {
    const used = (left: number): ClockRow => ({ pgn: shuffle(40, (p) => (p >= 38 ? left : 590_000 - p * 1000)), side: 'w' });
    const low = clockShare([used(400_000), used(350_000)]); // 200/600 and 250/600
    expect(low.games).toBe(2);
    expect(low.share).toBeCloseTo(225 / 600, 6);
    expect(low.state).toBe('low');
    expect(clockShare([used(100_000)]).state).toBe('good');
    expect(clockShare([used(240_000)]).state).toBe('good'); // exactly 60 %
    expect(clockShare([])).toEqual({ share: null, games: 0, state: null });
  });
  it('reads at most the newest 15 rows and counts at most 10 games', () => {
    const good = used();
    function used(): ClockRow {
      return { pgn: shuffle(40, (p) => (p >= 38 ? 100_000 : 590_000 - p * 1000)), side: 'w' };
    }
    const junk: ClockRow = { pgn: 'x', side: 'w' };
    expect(clockShare([...Array(15).fill(junk), good]).games).toBe(0);
    expect(clockShare(Array(20).fill(good)).games).toBe(10);
  });
});

describe('woodTimes', () => {
  const set = (id: string, createdAt: number) => ({ id, createdAt, items: [{ id: 'a' }] as unknown as Puzzle[], cycles: [{ n: 1, startedAt: 1, finishedAt: null, targetDays: 5 }] });
  it('picks the newest set', () => {
    expect(newestSet([set('a', 1), set('b', 3), set('c', 2)])?.id).toBe('b');
    expect(newestSet([])).toBeNull();
  });
  it('summarises its cycles', () => {
    const s = set('s', 1);
    const out = woodTimes(s, [{ puzzleId: 'a', solved: true, hintsUsed: 0, timeMs: 4000, at: 5, mode: 'woodpecker', setId: 's', cycle: 1 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ n: 1, done: 1, total: 1, medianMs: 4000 });
  });
});
