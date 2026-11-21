import { describe, expect, it, vi } from 'vitest';
import { createTablebase, flipCategory, TablebaseError } from './tablebase.ts';

const FEN = '8/8/8/4k3/8/8/3Q4/4K3 w - - 0 1';

/** Trimmed from a real tablebase.lichess.ovh/standard answer: move categories are from the opponent's side. */
const RAW = {
  checkmate: false,
  stalemate: false,
  insufficient_material: false,
  dtz: 15,
  dtm: 15,
  category: 'win',
  moves: [
    { uci: 'd2d5', san: 'Qd5+', zeroing: false, dtz: -14, dtm: -14, category: 'loss' },
    { uci: 'd2d1', san: 'Qd1', zeroing: false, dtz: -16, dtm: null, category: 'maybe-loss' },
    { uci: 'e1e2', san: 'Ke2', zeroing: false, dtz: 0, dtm: 0, category: 'draw' },
  ],
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('flipCategory', () => {
  it('swaps the viewpoint', () => {
    expect(flipCategory('loss')).toBe('win');
    expect(flipCategory('win')).toBe('loss');
    expect(flipCategory('cursed-win')).toBe('blessed-loss');
    expect(flipCategory('blessed-loss')).toBe('cursed-win');
    expect(flipCategory('maybe-win')).toBe('maybe-loss');
    expect(flipCategory('draw')).toBe('draw');
    expect(flipCategory('unknown')).toBe('unknown');
  });
});

describe('lookup', () => {
  it('parses the position and puts each move category on the side that plays it', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => okResponse(RAW));
    const tb = createTablebase({ fetchFn });
    const p = await tb.lookup(FEN);
    expect(p.category).toBe('win');
    expect(p.dtm).toBe(15);
    expect(p.dtz).toBe(15);
    expect(p.checkmate).toBe(false);
    expect(p.moves.map((m) => [m.uci, m.category])).toEqual([
      ['d2d5', 'win'],
      ['d2d1', 'maybe-win'],
      ['e1e2', 'draw'],
    ]);
    expect(p.moves[1]).toMatchObject({ dtm: null, dtz: -16, san: 'Qd1' });
    const url = String(fetchFn.mock.calls[0]![0]);
    expect(url.startsWith('https://tablebase.lichess.ovh/standard?fen=')).toBe(true);
    expect(decodeURIComponent(url.split('fen=')[1]!)).toBe(FEN);
  });

  it('caches by position (clock fields ignored)', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => okResponse(RAW));
    const tb = createTablebase({ fetchFn });
    await tb.lookup(FEN);
    await tb.lookup('8/8/8/4k3/8/8/3Q4/4K3 w - - 7 9');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('runs requests one at a time', async () => {
    let running = 0;
    let peak = 0;
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return okResponse(RAW);
    });
    const tb = createTablebase({ fetchFn });
    await Promise.all([
      tb.lookup('8/8/8/4k3/8/8/3Q4/4K3 w - - 0 1'),
      tb.lookup('8/8/8/4k3/8/8/2Q5/4K3 w - - 0 1'),
      tb.lookup('8/8/8/3k4/8/8/2Q5/4K3 w - - 0 1'),
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  it('reports a network failure as offline and does not cache it', async () => {
    const fetchFn = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse(RAW));
    const tb = createTablebase({ fetchFn });
    await expect(tb.lookup(FEN)).rejects.toMatchObject({ reason: 'offline' });
    await expect(tb.lookup(FEN)).resolves.toMatchObject({ category: 'win' });
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = (_url: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        });
      const tb = createTablebase({ fetchFn, timeoutMs: 3000 });
      const result = tb.lookup(FEN).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(3000);
      const err = await result;
      expect(err).toBeInstanceOf(TablebaseError);
      expect((err as TablebaseError).reason).toBe('offline');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a malformed or error answer', async () => {
    const bad = createTablebase({ fetchFn: async () => okResponse({ hello: 1 }) });
    await expect(bad.lookup(FEN)).rejects.toMatchObject({ reason: 'bad-response' });
    const illegal = createTablebase({ fetchFn: async () => new Response('illegal position', { status: 400 }) });
    await expect(illegal.lookup(FEN)).rejects.toMatchObject({ reason: 'bad-response' });
    const down = createTablebase({ fetchFn: async () => new Response('', { status: 503 }) });
    await expect(down.lookup(FEN)).rejects.toMatchObject({ reason: 'offline' });
  });

  it('backs off after a 429 without sending requests, then resumes', async () => {
    let now = 1_000;
    const fetchFn = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValue(okResponse(RAW));
    const tb = createTablebase({ fetchFn, now: () => now, backoffMs: 60_000 });
    await expect(tb.lookup(FEN)).rejects.toMatchObject({ reason: 'rate-limited' });
    await expect(tb.lookup(FEN)).rejects.toMatchObject({ reason: 'rate-limited' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 60_001;
    await expect(tb.lookup(FEN)).resolves.toMatchObject({ category: 'win' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
