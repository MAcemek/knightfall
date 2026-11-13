import { describe, expect, it } from 'vitest';
import { parsePgnGame } from '@knightfall/core';
import {
  fetchChesscomGame, fetchChesscomUserGames, fetchLichessGame, fetchLichessUserGames, readNdjson, resolveGameInput, type FetchFn, type FetchResponse,
} from './fetchers.ts';
import { gameFromChesscom, gameFromLichess, gameFromPgn, ImportError, sideOf } from './mappers.ts';

const NOW = 1_800_000_000_000;
const PGN = '[Event "Rated blitz game"]\n[Site "https://lichess.org/HqjDTU4A"]\n[Date "2026.10.14"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n[UTCDate "2026.10.14"]\n[UTCTime "18:04:06"]\n[WhiteElo "1510"]\n[BlackElo "1480"]\n[TimeControl "180+0"]\n[ECO "C20"]\n[Opening "King\'s Pawn Game"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';

const lichessJson = (over: Record<string, unknown> = {}) => ({
  id: 'HqjDTU4A',
  rated: true,
  variant: 'standard',
  speed: 'blitz',
  createdAt: 1792001046539,
  status: 'mate',
  players: {
    white: { user: { name: 'Alice', title: 'GM', id: 'alice' }, rating: 1510, analysis: { acpl: 41, accuracy: 84 } },
    black: { user: { name: 'Bob', id: 'bob' }, rating: 1480, analysis: { acpl: 65, accuracy: 79 } },
  },
  winner: 'white',
  opening: { eco: 'C20', name: "King's Pawn Game", ply: 2 },
  pgn: PGN,
  ...over,
});

const chesscomArchiveGame = (id: string, end: number, over: Record<string, unknown> = {}) => ({
  url: `https://www.chess.com/game/live/${id}`,
  pgn: '[Event "Live Chess"]\n[White "Carol"]\n[Black "Dave"]\n[Result "0-1"]\n[ECO "E62"]\n[ECOUrl "https://www.chess.com/openings/Kings-Indian-Defense-Fianchetto"]\n[WhiteElo "1700"]\n[BlackElo "1750"]\n[TimeControl "600"]\n\n1. d4 Nf6 2. c4 g6 0-1',
  time_class: 'rapid',
  end_time: end,
  rules: 'chess',
  accuracies: { white: 71.2, black: 88.4 },
  white: { username: 'Carol', rating: 1700 },
  black: { username: 'Dave', rating: 1750 },
  ...over,
});

const json = (body: unknown, status = 200): FetchResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const ndjson = (objects: unknown[], chunk = 37): FetchResponse => {
  const bytes = new TextEncoder().encode(objects.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
      c.close();
    },
  });
  return { ok: true, status: 200, json: async () => ({}), body };
};

describe('mappers', () => {
  it('gameFromPgn reads names, ratings, date, opening and makes a stable key', () => {
    const parsed = parsePgnGame(PGN);
    if (!parsed.ok) throw new Error(parsed.error);
    const g = gameFromPgn(parsed.game, NOW);
    expect(g).toMatchObject({
      source: 'pgn',
      white: { name: 'Alice', rating: 1510 },
      black: { name: 'Bob', rating: 1480 },
      result: '1-0',
      plies: 7,
      playedAt: Date.UTC(2026, 9, 14, 18, 4, 6),
      importedAt: NOW,
      timeControl: '180+0',
      opening: { eco: 'C20', name: "King's Pawn Game" },
    });
    expect(g.key).toMatch(/^pgn-[a-z0-9]+$/);
    expect(gameFromPgn(parsed.game, NOW + 5).key).toBe(g.key);
    expect(g.url).toBeUndefined();
  });
  it('gameFromPgn copes with a bare move list', () => {
    const parsed = parsePgnGame('1. e4 e5');
    if (!parsed.ok) throw new Error(parsed.error);
    expect(gameFromPgn(parsed.game, NOW)).toMatchObject({ white: { name: 'White' }, black: { name: 'Black' }, result: '*', playedAt: NOW });
  });
  it('gameFromLichess maps the API object', () => {
    expect(gameFromLichess(lichessJson(), NOW, 'ALICE')).toMatchObject({
      key: 'li-HqjDTU4A',
      source: 'lichess',
      url: 'https://lichess.org/HqjDTU4A',
      white: { name: 'Alice', rating: 1510, title: 'GM' },
      black: { name: 'Bob', rating: 1480 },
      result: '1-0',
      plies: 7,
      playedAt: 1792001046539,
      speed: 'blitz',
      opening: { eco: 'C20', name: "King's Pawn Game" },
      siteAccuracy: { white: 84, black: 79 },
      importedFor: 'alice',
    });
  });
  it('gameFromLichess handles anonymous/AI players, missing analysis, and rejects variants or junk', () => {
    const g = gameFromLichess(lichessJson({ players: { white: { aiLevel: 3 }, black: {} } }), NOW)!;
    expect(g.white.name).toBe('Stockfish level 3');
    expect(g.black.name).toBe('Anonymous');
    expect(g.siteAccuracy).toBeUndefined();
    expect(g.importedFor).toBeUndefined();
    expect(gameFromLichess(lichessJson({ variant: 'atomic' }), NOW)).toBeNull();
    expect(gameFromLichess(lichessJson({ pgn: undefined }), NOW)).toBeNull();
    expect(gameFromLichess(lichessJson({ id: '../x' }), NOW)).toBeNull();
    expect(gameFromLichess(null, NOW)).toBeNull();
  });
  it('gameFromChesscom maps archive entries and our server response', () => {
    const fromArchive = gameFromChesscom(chesscomArchiveGame('123', 1790978999), NOW, 'Dave')!;
    expect(fromArchive).toMatchObject({
      key: 'cc-live-123',
      source: 'chesscom',
      url: 'https://www.chess.com/game/live/123',
      white: { name: 'Carol', rating: 1700 },
      black: { name: 'Dave', rating: 1750 },
      result: '0-1',
      plies: 4,
      playedAt: 1790978999000,
      speed: 'rapid',
      timeControl: '600',
      opening: { eco: 'E62', name: 'Kings Indian Defense Fianchetto' },
      siteAccuracy: { white: 71.2, black: 88.4 },
      importedFor: 'dave',
    });
    const a = chesscomArchiveGame('123', 1790978999);
    const fromServer = gameFromChesscom({ pgn: a.pgn, url: a.url, white: { username: 'Carol' }, black: { username: 'Dave' }, timeClass: 'rapid', endTime: 1790978999 }, NOW)!;
    expect(fromServer).toMatchObject({ key: 'cc-live-123', speed: 'rapid', playedAt: 1790978999000, white: { name: 'Carol', rating: 1700 } });
    expect(fromServer.siteAccuracy).toBeUndefined();
  });
  it('gameFromChesscom rejects variants, foreign URLs and junk', () => {
    expect(gameFromChesscom(chesscomArchiveGame('1', 1, { rules: 'chess960' }), NOW)).toBeNull();
    expect(gameFromChesscom(chesscomArchiveGame('1', 1, { url: 'https://www.chess.com/game/computer/1' }), NOW)).toBeNull();
    expect(gameFromChesscom(chesscomArchiveGame('1', 1, { pgn: 'nonsense' }), NOW)).toBeNull();
    expect(gameFromChesscom('x', NOW)).toBeNull();
  });
  it('sideOf finds the user\'s colour', () => {
    const g = { white: { name: 'Alice' }, black: { name: 'Bob' } };
    expect(sideOf(g, 'alice')).toBe('w');
    expect(sideOf(g, 'BOB')).toBe('b');
    expect(sideOf(g, 'carol')).toBeNull();
    expect(sideOf(g, undefined)).toBeNull();
  });
});

describe('readNdjson', () => {
  it('reassembles lines split across chunks (and inside multi-byte characters) and skips bad lines', async () => {
    const text = '{"a":1}\n{"name":"Żółć ♞"}\nnot json\n\n{"a":3}';
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 5) c.enqueue(bytes.slice(i, i + 5));
        c.close();
      },
    });
    const seen: unknown[] = [];
    await readNdjson(stream, (o) => seen.push(o));
    expect(seen).toEqual([{ a: 1 }, { name: 'Żółć ♞' }, { a: 3 }]);
  });
});

describe('Lichess fetchers', () => {
  it('fetches one game with the documented query and Accept header', async () => {
    const calls: { url: string; accept?: string }[] = [];
    const fetchFn: FetchFn = async (url, init) => (calls.push({ url, accept: init?.headers?.Accept }), json(lichessJson()));
    const g = await fetchLichessGame('HqjDTU4A', fetchFn, NOW);
    expect(g.key).toBe('li-HqjDTU4A');
    expect(calls).toEqual([{ url: 'https://lichess.org/game/export/HqjDTU4A?pgnInJson=true&clocks=true&evals=false&opening=true&accuracy=true', accept: 'application/json' }]);
  });
  it('maps 404, 429, network failure and variants to ImportError', async () => {
    await expect(fetchLichessGame('HqjDTU4A', async () => json({}, 404), NOW)).rejects.toMatchObject({ code: 'not_found', fallback: 'pgn' });
    await expect(fetchLichessGame('HqjDTU4A', async () => json({}, 429), NOW)).rejects.toMatchObject({ code: 'rate_limited', message: 'Lichess is busy. Try again in a minute.' });
    await expect(fetchLichessGame('HqjDTU4A', async () => Promise.reject(new TypeError('Failed to fetch')), NOW)).rejects.toMatchObject({ code: 'network' });
    await expect(fetchLichessGame('HqjDTU4A', async () => json(lichessJson({ variant: 'atomic' })), NOW)).rejects.toMatchObject({ code: 'invalid' });
    await expect(fetchLichessGame('bad id!', async () => json({}), NOW)).rejects.toBeInstanceOf(ImportError);
  });
  it('streams a user\'s games as ndjson, skipping variants', async () => {
    const calls: { url: string; accept?: string }[] = [];
    const stream = [lichessJson(), lichessJson({ id: 'AAAAAAAA', variant: 'chess960' }), lichessJson({ id: 'BBBBBBBB' })];
    const streamed: string[] = [];
    const games = await fetchLichessUserGames(' Alice ', {
      fetchFn: async (url, init) => (calls.push({ url, accept: init?.headers?.Accept }), ndjson(stream)),
      onGame: (g) => streamed.push(g.key),
      now: NOW,
    });
    expect(games.map((g) => g.key)).toEqual(['li-HqjDTU4A', 'li-BBBBBBBB']);
    expect(streamed).toEqual(['li-HqjDTU4A', 'li-BBBBBBBB']);
    expect(games[0].importedFor).toBe('alice');
    expect(calls[0].url).toContain('https://lichess.org/api/games/user/Alice?max=30&pgnInJson=true&clocks=true&opening=true&accuracy=true');
    expect(calls[0].accept).toBe('application/x-ndjson');
  });
  it('validates the username and reports unknown users and rate limits', async () => {
    const never: FetchFn = async () => {
      throw new Error('must not be called');
    };
    await expect(fetchLichessUserGames('a b/c', { fetchFn: never })).rejects.toMatchObject({ code: 'invalid' });
    await expect(fetchLichessUserGames('ghost', { fetchFn: async () => json({}, 404) })).rejects.toMatchObject({ code: 'not_found' });
    await expect(fetchLichessUserGames('alice', { fetchFn: async () => json({}, 429) })).rejects.toMatchObject({ code: 'rate_limited' });
  });
  it('runs Lichess requests one at a time', async () => {
    let active = 0;
    let peak = 0;
    const fetchFn: FetchFn = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;
      return json(lichessJson());
    };
    await Promise.all([fetchLichessGame('HqjDTU4A', fetchFn), fetchLichessGame('HqjDTU4A', fetchFn), fetchLichessUserGames('alice', { fetchFn: async (u) => ({ ...(await fetchFn(u)), body: ndjson([]).body }) })]);
    expect(peak).toBe(1);
  });
});

describe('chess.com fetchers', () => {
  const root = 'https://api.chess.com/pub/player/dave/games';
  it('reads the newest archives serially, newest game first, up to max', async () => {
    const calls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      calls.push(url);
      if (url === `${root}/archives`) return json({ archives: [`${root}/2026/08`, `${root}/2026/10`, `${root}/2026/09`, 'https://evil.example/games/2026/11'] });
      if (url === `${root}/2026/10`) return json({ games: [chesscomArchiveGame('1', 100), chesscomArchiveGame('2', 300), chesscomArchiveGame('3', 200, { rules: 'chess960' })] });
      if (url === `${root}/2026/09`) return json({ games: [chesscomArchiveGame('4', 50), chesscomArchiveGame('5', 60)] });
      return json({}, 404);
    };
    const games = await fetchChesscomUserGames('Dave', { fetchFn, max: 3, now: NOW });
    expect(games.map((g) => g.key)).toEqual(['cc-live-2', 'cc-live-1', 'cc-live-5']);
    // Entries that are not api.chess.com archive URLs are ignored, and no URL from the response is fetched as is.
    expect(calls).toEqual([`${root}/archives`, `${root}/2026/10`, `${root}/2026/09`]);
    expect(calls.every((u) => u.startsWith('https://api.chess.com/pub/player/dave/games'))).toBe(true);
  });
  it('reports unknown players, bad names and rate limits', async () => {
    await expect(fetchChesscomUserGames('ghost', { fetchFn: async () => json({}, 404) })).rejects.toMatchObject({ code: 'not_found' });
    await expect(fetchChesscomUserGames('x', { fetchFn: async () => json({}) })).rejects.toMatchObject({ code: 'invalid' });
    await expect(fetchChesscomUserGames('dave', { fetchFn: async () => json({}, 429) })).rejects.toMatchObject({ code: 'rate_limited', message: 'chess.com is busy. Try again in a minute.' });
  });
  it('looks a link up through the Knightfall server', async () => {
    const a = chesscomArchiveGame('123', 1790978999);
    const urls: string[] = [];
    const g = await fetchChesscomGame('live', '123', async (url) => (urls.push(url), json({ pgn: a.pgn, url: a.url, white: { username: 'Carol', rating: 1700 }, black: { username: 'Dave', rating: 1750 }, timeClass: 'rapid' })), NOW);
    expect(urls).toEqual(['/api/chesscom/game/live/123']);
    expect(g.key).toBe('cc-live-123');
  });
  it('turns server errors into ImportError with the fallback to offer', async () => {
    const fail = (body: unknown, status: number) => fetchChesscomGame('live', '123', async () => json(body, status), NOW);
    await expect(fail({ error: 'chess.com has no game with that id.', code: 'not_found', fallback: 'pgn' }, 404)).rejects.toMatchObject({ code: 'not_found', fallback: 'pgn', message: 'chess.com has no game with that id.' });
    await expect(fail({ error: 'busy', code: 'rate_limited', fallback: 'username' }, 429)).rejects.toMatchObject({ code: 'rate_limited', fallback: 'username' });
    await expect(fail({ error: 'x', code: 'upstream', fallback: 'username' }, 502)).rejects.toMatchObject({ code: 'server', fallback: 'username' });
    await expect(fetchChesscomGame('live', '123', async () => Promise.reject(new TypeError('Failed to fetch')), NOW)).rejects.toMatchObject({ code: 'server', fallback: 'username' });
    // The dev server answering with index.html (server down): not JSON.
    const html: FetchResponse = { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('Unexpected token <')) };
    await expect(fetchChesscomGame('live', '123', async () => html, NOW)).rejects.toMatchObject({ code: 'server', fallback: 'username' });
  });
});

describe('resolveGameInput', () => {
  const fetchFn: FetchFn = async (url) => {
    if (url.startsWith('https://lichess.org/game/export/')) return json(lichessJson());
    if (url.startsWith('/api/chesscom/game/')) {
      const a = chesscomArchiveGame('123', 1790978999);
      return json({ pgn: a.pgn, url: a.url, white: { username: 'Carol' }, black: { username: 'Dave' } });
    }
    return json({}, 404);
  };
  it('routes links and PGN', async () => {
    expect((await resolveGameInput('https://lichess.org/HqjDTU4A/black#12', fetchFn, NOW)).games[0].key).toBe('li-HqjDTU4A');
    expect((await resolveGameInput('https://www.chess.com/game/live/123', fetchFn, NOW)).games[0].key).toBe('cc-live-123');
    const multi = await resolveGameInput(`${PGN}\n\n[Event "Two"]\n\n1. d4 d5 *\n\n[Event "Bad"]\n\n1. e4 Ke3 *`, fetchFn, NOW);
    expect(multi.games).toHaveLength(2);
    expect(multi.games.every((g) => g.source === 'pgn')).toBe(true);
    expect(multi.warnings).toHaveLength(1);
  });
  it('throws ImportError for unusable input', async () => {
    await expect(resolveGameInput('', fetchFn, NOW)).rejects.toMatchObject({ code: 'invalid', message: 'Paste a game link or a PGN.' });
    await expect(resolveGameInput('https://example.com/x', fetchFn, NOW)).rejects.toBeInstanceOf(ImportError);
    await expect(resolveGameInput('1. e4 Ke3', fetchFn, NOW)).rejects.toMatchObject({ code: 'invalid' });
  });
});
