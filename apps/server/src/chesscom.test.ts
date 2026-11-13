import { describe, expect, it } from 'vitest';
import { archiveMonths, createChesscomLookup, findInArchive, USER_AGENT, type FetchLike } from './chesscom.ts';
import { CLIENT_TYPES, isClientMessage } from './clientTypes.ts';
import { handleApi, matchChesscomRoute } from './http.ts';
import { LruCache } from './lru.ts';

const ID = '184727190848';
const CALLBACK = `https://www.chess.com/callback/live/game/${ID}`;
const ARCHIVE = 'https://api.chess.com/pub/player/alice/games/2026/10';

const callbackBody = (over: Record<string, unknown> = {}) => ({
  game: { id: Number(ID), isFinished: true, endTime: 1790978999, pgnHeaders: { White: 'Alice', Black: 'Bob', Date: '2026.10.02' }, ...over },
});
const archiveBody = {
  games: [
    { url: 'https://www.chess.com/game/live/999', pgn: '1. d4 *', white: { username: 'Alice', rating: 1500 }, black: { username: 'Zed', rating: 1400 } },
    {
      url: `https://www.chess.com/game/live/${ID}`,
      pgn: '[White "Alice"]\n\n1. e4 e5 1-0',
      time_class: 'blitz',
      end_time: 1790978999,
      accuracies: { white: 90.17, black: 81.96 },
      white: { username: 'Alice', rating: 1510 },
      black: { username: 'Bob', rating: 1480 },
    },
  ],
};

interface Stub {
  fetch: FetchLike;
  calls: { url: string; ua: string }[];
}

/** Fetch stub: `routes` maps a URL to a JSON body, an HTTP status, or 'hang' (never answers until aborted). */
function stub(routes: Record<string, unknown>): Stub {
  const calls: Stub['calls'] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, ua: init.headers['User-Agent'] });
    const r = routes[url];
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    if (typeof r === 'number') return Promise.resolve({ ok: false, status: r, json: async () => ({}) });
    if (r === undefined) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => r });
  };
  return { fetch, calls };
}

describe('chess.com lookup', () => {
  it('resolves callback -> monthly archive -> game by URL', async () => {
    const s = stub({ [CALLBACK]: callbackBody(), [ARCHIVE]: archiveBody });
    const lookup = createChesscomLookup({ fetch: s.fetch });
    const r = await lookup('live', ID);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      pgn: '[White "Alice"]\n\n1. e4 e5 1-0',
      url: `https://www.chess.com/game/live/${ID}`,
      white: { username: 'Alice', rating: 1510 },
      black: { username: 'Bob', rating: 1480 },
      accuracies: { white: 90.17, black: 81.96 },
      timeClass: 'blitz',
      endTime: 1790978999,
    });
    expect(s.calls.map((c) => c.url)).toEqual([CALLBACK, ARCHIVE]);
    expect(s.calls.every((c) => c.ua === USER_AGENT)).toBe(true);
    expect(USER_AGENT).toBe('Knightfall/0.1');
  });

  it('serves repeats from the cache and shares one in-flight lookup', async () => {
    const s = stub({ [CALLBACK]: callbackBody(), [ARCHIVE]: archiveBody });
    const lookup = createChesscomLookup({ fetch: s.fetch });
    const [a, b] = await Promise.all([lookup('live', ID), lookup('live', ID)]);
    expect(a).toBe(b);
    await lookup('live', ID);
    expect(s.calls).toHaveLength(2);
  });

  it('expires cached games after the ttl', async () => {
    let t = 0;
    const s = stub({ [CALLBACK]: callbackBody(), [ARCHIVE]: archiveBody });
    const lookup = createChesscomLookup({ fetch: s.fetch, now: () => t, ttlMs: 1000 });
    await lookup('live', ID);
    t = 999;
    await lookup('live', ID);
    expect(s.calls).toHaveLength(2);
    t = 1001;
    await lookup('live', ID);
    expect(s.calls).toHaveLength(4);
  });

  it('rejects bad input without calling upstream', async () => {
    const s = stub({});
    const lookup = createChesscomLookup({ fetch: s.fetch });
    for (const [type, id] of [['live', '12a'], ['live', ''], ['computer', '1'], ['live', '../1'], ['daily', '1'.repeat(21)]]) {
      const r = await lookup(type, id);
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'bad_request', fallback: 'pgn' });
    }
    expect(s.calls).toHaveLength(0);
  });

  it('maps an unknown game to 404 with the PGN fallback', async () => {
    const lookup = createChesscomLookup({ fetch: stub({ [CALLBACK]: 404 }).fetch });
    expect(await lookup('live', ID)).toEqual({ status: 404, body: { error: 'chess.com has no game with that id.', code: 'not_found', fallback: 'pgn' } });
  });

  it('maps an unfinished game to 409', async () => {
    const lookup = createChesscomLookup({ fetch: stub({ [CALLBACK]: callbackBody({ isFinished: false }) }).fetch });
    expect(await lookup('live', ID)).toMatchObject({ status: 409, body: { code: 'not_finished', fallback: 'pgn' } });
  });

  it('falls back to "username" when the archive does not contain the game', async () => {
    const s = stub({ [CALLBACK]: callbackBody(), [ARCHIVE]: { games: [] } });
    const r = await createChesscomLookup({ fetch: s.fetch })('live', ID);
    expect(r).toMatchObject({ status: 404, body: { code: 'not_found', fallback: 'username' } });
  });

  it('tries the start month when the end month has no archive', async () => {
    const sept = 'https://api.chess.com/pub/player/alice/games/2026/09';
    const s = stub({ [CALLBACK]: callbackBody({ pgnHeaders: { White: 'Alice', Black: 'Bob', Date: '2026.09.30' } }), [ARCHIVE]: 404, [sept]: archiveBody });
    const r = await createChesscomLookup({ fetch: s.fetch })('live', ID);
    expect(r.status).toBe(200);
    expect(s.calls.map((c) => c.url)).toEqual([CALLBACK, ARCHIVE, sept]);
  });

  it('maps upstream failures: 429, 5xx, malformed body, timeout', async () => {
    expect(await createChesscomLookup({ fetch: stub({ [CALLBACK]: 429 }).fetch })('live', ID)).toMatchObject({ status: 429, body: { code: 'rate_limited', fallback: 'username' } });
    expect(await createChesscomLookup({ fetch: stub({ [CALLBACK]: 503 }).fetch })('live', ID)).toMatchObject({ status: 502, body: { code: 'upstream', fallback: 'username' } });
    expect(await createChesscomLookup({ fetch: stub({ [CALLBACK]: { nope: true } }).fetch })('live', ID)).toMatchObject({ status: 502, body: { code: 'upstream' } });
    expect(await createChesscomLookup({ fetch: stub({ [CALLBACK]: callbackBody(), [ARCHIVE]: 500 }).fetch })('live', ID)).toMatchObject({ status: 502 });
    const slow = createChesscomLookup({ fetch: stub({ [CALLBACK]: 'hang' }).fetch, timeoutMs: 20 });
    expect(await slow('live', ID)).toMatchObject({ status: 504, body: { code: 'timeout', fallback: 'username' } });
  });

  it('never puts a strange username into an upstream URL', async () => {
    const s = stub({ [CALLBACK]: callbackBody({ pgnHeaders: { White: '../../x?y', Black: 'Bob', Date: '2026.10.02' } }) });
    const r = await createChesscomLookup({ fetch: s.fetch })('live', ID);
    expect(r.status).toBe(502);
    expect(s.calls).toHaveLength(1);
  });

  it('sends upstream requests one at a time per host', async () => {
    let active = 0;
    let peak = 0;
    const fetch: FetchLike = async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ok: true, status: 200, json: async () => (url.includes('/callback/') ? callbackBody() : archiveBody) };
    };
    const lookup = createChesscomLookup({ fetch });
    await Promise.all(['1', '2', '3', '4'].map((id) => lookup('live', id)));
    // Two hosts (www.chess.com, api.chess.com), each strictly serial.
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('limits uncached lookups per minute', async () => {
    let t = 0;
    const s = stub({});
    const lookup = createChesscomLookup({ fetch: s.fetch, now: () => t, maxPerMinute: 2 });
    await lookup('live', '1');
    await lookup('live', '2');
    expect(await lookup('live', '3')).toMatchObject({ status: 429, body: { code: 'rate_limited', fallback: 'pgn' } });
    t = 61_000;
    expect((await lookup('live', '3')).status).toBe(404);
  });
});

describe('archive helpers', () => {
  it('archiveMonths prefers the end month, then the start month', () => {
    expect(archiveMonths(1790978999, '2026.10.02')).toEqual([[2026, 10]]);
    expect(archiveMonths(1790978999, '2026.09.30')).toEqual([[2026, 10], [2026, 9]]);
    expect(archiveMonths(undefined, '2026.12.31')).toEqual([[2026, 12], [2027, 1]]);
    expect(archiveMonths(undefined, 'junk')).toEqual([]);
  });
  it('findInArchive matches type and id exactly', () => {
    expect(findInArchive(archiveBody, 'live', ID)?.white.username).toBe('Alice');
    expect(findInArchive(archiveBody, 'daily', ID)).toBeNull();
    expect(findInArchive(archiveBody, 'live', ID.slice(1))).toBeNull();
    expect(findInArchive(null, 'live', ID)).toBeNull();
    expect(findInArchive({ games: [{ url: `x/live/${ID}` }] }, 'live', ID)).toBeNull();
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry and honours the ttl', () => {
    let t = 0;
    const c = new LruCache<number>(2, 100, () => t);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1); // a is now the most recent
    c.set('c', 3); // evicts b
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.size).toBe(2);
    t = 100;
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(1);
    c.set('d', 4, 1000);
    t = 900;
    expect(c.get('d')).toBe(4);
  });
});

describe('http routing', () => {
  const deps = { chesscom: async (type: string, id: string) => ({ status: 200, body: { type, id } as never }) };
  it('matches the chess.com route only', () => {
    expect(matchChesscomRoute('/api/chesscom/game/live/123')).toEqual({ type: 'live', id: '123' });
    expect(matchChesscomRoute('/api/chesscom/game/daily/9/?x=1')).toEqual({ type: 'daily', id: '9' });
    expect(matchChesscomRoute('/api/chesscom/game/live/12a')).toBeNull();
    expect(matchChesscomRoute('/api/chesscom/game/computer/1')).toBeNull();
    expect(matchChesscomRoute('/api/chesscom/game/live/1/extra')).toBeNull();
    expect(matchChesscomRoute('/api/chesscom/game/live/%31')).toBeNull();
  });
  it('routes requests', async () => {
    expect(await handleApi('GET', '/api/chesscom/game/live/123', deps)).toEqual({ status: 200, body: { type: 'live', id: '123' } });
    expect(await handleApi('GET', '/api/health', deps)).toEqual({ status: 200, body: { ok: true } });
    expect((await handleApi('POST', '/api/chesscom/game/live/123', deps)).status).toBe(405);
    expect((await handleApi('GET', '/api/chesscom/game/live/abc', deps)).status).toBe(400);
    expect((await handleApi('GET', '/api/other', deps)).status).toBe(404);
    expect((await handleApi('GET', '/', deps)).status).toBe(404);
    expect((await handleApi('GET', '/ws', deps)).status).toBe(404);
  });
});

describe('client message types', () => {
  it('accepts every protocol message, including claim', () => {
    for (const type of ['queue', 'cancel', 'progress', 'rematch', 'leave', 'claim', 'ping']) expect(CLIENT_TYPES.has(type)).toBe(true);
    expect(CLIENT_TYPES.size).toBe(7);
    expect(isClientMessage({ type: 'claim' })).toBe(true);
    expect(isClientMessage({ type: 'matched' })).toBe(false);
    expect(isClientMessage(null)).toBe(false);
  });
});
