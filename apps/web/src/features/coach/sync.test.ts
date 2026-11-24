import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Row = { key: string; value: unknown };
  const kv = new Map<string, Row>();
  const rating = new Map<string, unknown>();
  const games = new Map<string, { key: string }>();
  const db = {
    kv: {
      get: async (k: string) => kv.get(k),
      put: async (r: Row) => void kv.set(r.key, r),
      delete: async (k: string) => void kv.delete(k),
    },
    ratingLog: { bulkPut: async (rows: { id: string }[]) => void rows.forEach((r) => rating.set(r.id, r)) },
    games: { where: () => ({ equals: () => ({ primaryKeys: async () => [...games.keys()] }) }) },
    transaction: async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)(),
  };
  return { kv, rating, games, db };
});

vi.mock('../../shared/db.ts', async (orig) => ({ ...(await orig<typeof import('../../shared/db.ts')>()), db: h.db }));
vi.mock('../../shared/analysis/store.ts', () => ({
  saveGames: async (list: { key: string }[]) => {
    for (const g of list) h.games.set(g.key, g);
  },
}));

import { KEYS } from '../../shared/db.ts';
import { localDateKey } from '../../shared/localDate.ts';
import type { FetchFn, FetchResponse } from '../../shared/importers/fetchers.ts';
import { AUTO_GAP_MS, fetchChesscomStats, MANUAL_GAP_MS, resetSyncState, syncCoach } from './sync.ts';
import { sanitizeActivity } from './stopRules.ts';

const json = (body: unknown, status = 200): FetchResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const NOW = new Date(2026, 10, 18, 15, 0, 0).getTime();
const endSec = (minutesAgo: number) => Math.floor((NOW - minutesAgo * 60_000) / 1000);
const PGN = (white: string, black: string) => `[Event "Live Chess"]\n[White "${white}"]\n[Black "${black}"]\n[Result "1-0"]\n[TimeControl "600"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;

function entry(id: string, cls: string, minutesAgo: number, mine: 'white' | 'black', myResult: string, over: Record<string, unknown> = {}) {
  const other = mine === 'white' ? 'black' : 'white';
  return {
    url: `https://www.chess.com/game/${cls === 'daily' ? 'daily' : 'live'}/${id}`,
    pgn: PGN(mine === 'white' ? 'Dave' : 'Rival', mine === 'white' ? 'Rival' : 'Dave'),
    time_class: cls,
    rules: 'chess',
    end_time: endSec(minutesAgo),
    [mine]: { username: 'Dave', rating: 1500, result: myResult },
    [other]: { username: 'Rival', rating: 1500, result: 'win' },
    ...over,
  };
}

const root = 'https://api.chess.com/pub/player/dave';
const MONTH = '2026/11';
const stats = { chess_rapid: { last: { rating: 1612 } }, chess_blitz: { last: { rating: 1480 } }, chess_bullet: { last: { rating: 1301 } }, chess_daily: { last: { rating: 1190 } } };

function api(entries: unknown[], calls: string[] = []): FetchFn {
  return async (url) => {
    calls.push(url);
    if (url === `${root}/stats`) return json(stats);
    if (url === `${root}/games/archives`) return json({ archives: [`${root}/games/${MONTH}`] });
    if (url === `${root}/games/${MONTH}`) return json({ games: entries });
    return json({}, 404);
  };
}

const setPlan = (username: string) => h.kv.set(KEYS.coachPlan, { key: KEYS.coachPlan, value: { username, startDate: '2026-11-02', baselines: {}, targets: {} } });
const activityNow = () => sanitizeActivity(h.kv.get(KEYS.coachActivity)?.value, NOW);

beforeEach(() => {
  h.kv.clear();
  h.rating.clear();
  h.games.clear();
  resetSyncState();
});

describe('fetchChesscomStats', () => {
  it('reads the four ratings and asks only for the stats of that user', async () => {
    const urls: string[] = [];
    const r = await fetchChesscomStats('Dave', async (u) => (urls.push(u), json({ ...stats, chess_daily: undefined, chess_blitz: { last: { rating: 'x' } } })));
    expect(urls).toEqual([`${root}/stats`]);
    expect(r).toEqual({ rapid: 1612, blitz: null, bullet: 1301, daily: null });
  });
  it('checks the name before it goes into a URL', async () => {
    await expect(fetchChesscomStats('../x', async () => json({}))).rejects.toMatchObject({ code: 'invalid' });
    await expect(fetchChesscomStats('a b', async () => json({}))).rejects.toMatchObject({ code: 'invalid' });
  });
  it('turns failures into friendly errors', async () => {
    await expect(fetchChesscomStats('ghost', async () => json({}, 404))).rejects.toMatchObject({ code: 'not_found' });
    await expect(fetchChesscomStats('dave', async () => json({}, 429))).rejects.toMatchObject({ code: 'rate_limited', message: 'chess.com is busy. Try again in a minute.' });
    await expect(fetchChesscomStats('dave', async () => Promise.reject(new TypeError('Failed to fetch')))).rejects.toMatchObject({
      code: 'network',
      message: 'chess.com could not be reached. Check your connection.',
    });
    await expect(fetchChesscomStats('dave', async () => json({}, 500))).rejects.toMatchObject({ code: 'network' });
    const bad: FetchResponse = { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('x')) };
    await expect(fetchChesscomStats('dave', async () => bad)).rejects.toMatchObject({ code: 'server' });
  });
});

describe('syncCoach', () => {
  const entries = [
    entry('1', 'rapid', 30, 'white', 'win'),
    entry('2', 'blitz', 25, 'black', 'resigned'),
    entry('3', 'blitz', 20, 'white', 'repetition'),
    entry('4', 'bullet', 10, 'white', 'win'),
    entry('5', 'blitz', 9, 'white', 'win', { rules: 'chess960' }),
    entry('6', 'daily', 600, 'black', 'timeout'),
    { ...entry('7', 'blitz', 8, 'white', 'win'), white: { username: 'Somebody', result: 'win' }, black: { username: 'Rival', result: 'resigned' } },
  ];

  it('does nothing without a plan or a username', async () => {
    const calls: string[] = [];
    expect(await syncCoach({ fetchFn: api(entries, calls), now: NOW })).toMatchObject({ skipped: 'no-plan' });
    setPlan('');
    resetSyncState();
    expect(await syncCoach({ fetchFn: api(entries, calls), now: NOW })).toMatchObject({ skipped: 'no-plan' });
    expect(calls).toEqual([]);
  });

  it('stores ratings, new rapid and Daily games, and the fast games', async () => {
    setPlan('Dave');
    const r = await syncCoach({ fetchFn: api(entries), now: NOW });
    expect(r).toEqual({ newGames: 2, ratings: 4 });
    const date = localDateKey(new Date(NOW));
    expect([...h.rating.keys()].sort()).toEqual([`chesscom-bullet-${date}`, `chesscom-blitz-${date}`, `chesscom-daily-${date}`, `chesscom-rapid-${date}`].sort());
    expect(h.rating.get(`chesscom-rapid-${date}`)).toMatchObject({ rating: 1612, date, site: 'chesscom', speed: 'rapid', user: 'dave' });
    expect([...h.games.keys()].sort()).toEqual(['cc-daily-6', 'cc-live-1']);
    const a = activityNow();
    expect(a.user).toBe('dave');
    expect(a.lastSync).toBe(NOW);
    expect(a.games.map((g) => [g.key, g.speed, g.result])).toEqual([
      ['cc-live-2', 'blitz', 'loss'],
      ['cc-live-3', 'blitz', 'draw'],
      ['cc-live-4', 'bullet', 'win'],
    ]);
  });

  it('a second sync changes nothing', async () => {
    setPlan('Dave');
    await syncCoach({ fetchFn: api(entries), now: NOW });
    const games = [...h.games.keys()];
    const ratings = [...h.rating.entries()];
    const before = activityNow().games;
    const r = await syncCoach({ fetchFn: api(entries), now: NOW + AUTO_GAP_MS + 1 });
    expect(r).toEqual({ newGames: 0, ratings: 4 });
    expect([...h.games.keys()]).toEqual(games);
    expect([...h.rating.entries()]).toEqual(ratings);
    expect(activityNow().games).toEqual(before);
  });

  it('waits 15 minutes between automatic syncs, also after a failure', async () => {
    setPlan('Dave');
    await syncCoach({ fetchFn: api(entries), now: NOW });
    expect(await syncCoach({ fetchFn: api(entries), now: NOW + 14 * 60_000 })).toMatchObject({ skipped: 'recent' });
    resetSyncState();
    h.kv.delete(KEYS.coachActivity);
    const failing: FetchFn = async () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(syncCoach({ fetchFn: failing, now: NOW })).rejects.toMatchObject({ code: 'network' });
    expect(await syncCoach({ fetchFn: api(entries), now: NOW + 60_000 })).toMatchObject({ skipped: 'recent' });
    expect(await syncCoach({ fetchFn: api(entries), now: NOW + AUTO_GAP_MS })).toMatchObject({ ratings: 4 });
  });

  it('a manual sync waits 20 seconds after the last try', async () => {
    setPlan('Dave');
    await syncCoach({ fetchFn: api(entries), now: NOW });
    expect(await syncCoach({ force: true, fetchFn: api(entries), now: NOW + MANUAL_GAP_MS - 1 })).toMatchObject({ skipped: 'recent' });
    expect(await syncCoach({ force: true, fetchFn: api(entries), now: NOW + MANUAL_GAP_MS })).toMatchObject({ ratings: 4 });
  });

  it('runs one sync at a time', async () => {
    setPlan('Dave');
    const calls: string[] = [];
    const [a, b] = await Promise.all([syncCoach({ fetchFn: api(entries, calls), now: NOW }), syncCoach({ force: true, fetchFn: api(entries, calls), now: NOW })]);
    expect(a).toBe(b);
    expect(calls.filter((u) => u.endsWith('/stats'))).toHaveLength(1);
  });

  it('drops the results when the username changed during the sync', async () => {
    setPlan('Dave');
    const inner = api(entries);
    const switching: FetchFn = async (url) => {
      const res = await inner(url);
      if (url.endsWith('/stats')) setPlan('Someone');
      return res;
    };
    expect(await syncCoach({ fetchFn: switching, now: NOW })).toMatchObject({ skipped: 'changed' });
    expect(h.rating.size).toBe(0);
    expect(h.games.size).toBe(0);
    expect(h.kv.get(KEYS.coachActivity)).toBeUndefined();
  });

  it('reports an unknown player', async () => {
    setPlan('Dave');
    await expect(syncCoach({ fetchFn: async () => json({}, 404), now: NOW })).rejects.toMatchObject({ code: 'not_found' });
    expect(h.rating.size).toBe(0);
  });
});
