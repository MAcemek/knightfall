import { describe, expect, it } from 'vitest';
import { BOT_MAX, BOT_MIN, BotEngine, clampElo } from './botEngine.ts';
import { isAbortError } from './pool.ts';
import type { UciTransport } from './uci.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A transport that answers the handshake and records everything posted. Searches are answered by the test. */
function fake() {
  const posted: string[] = [];
  let line: (l: string) => void = () => {};
  let error: (m: string) => void = () => {};
  let terminated = false;
  const transport: UciTransport = {
    post: (c) => {
      posted.push(c);
      if (c === 'uci') queueMicrotask(() => line('uciok'));
      if (c === 'isready') queueMicrotask(() => line('readyok'));
    },
    onLine: (l) => {
      line = l;
    },
    onError: (e) => {
      error = e;
    },
    terminate: () => {
      terminated = true;
    },
  };
  return { transport, posted, say: (l: string) => line(l), crash: (m: string) => error(m), isTerminated: () => terminated };
}

describe('clampElo', () => {
  it('keeps the strength inside the engine range', () => {
    expect(clampElo(1000)).toBe(BOT_MIN);
    expect(clampElo(9999)).toBe(BOT_MAX);
    expect(clampElo(1650.4)).toBe(1650);
    expect(clampElo(Number.NaN)).toBe(BOT_MIN);
  });
});

describe('BotEngine', () => {
  it('sets the options in order before the first search', async () => {
    const f = fake();
    const bot = new BotEngine(f.transport, 1650);
    await bot.ready();
    expect(f.posted).toEqual([
      'uci',
      'setoption name UCI_LimitStrength value true',
      'setoption name UCI_Elo value 1650',
      'ucinewgame',
      'isready',
    ]);
  });

  it('clamps the strength it sends', async () => {
    const f = fake();
    await new BotEngine(f.transport, 100).ready();
    expect(f.posted).toContain(`setoption name UCI_Elo value ${BOT_MIN}`);
    const g = fake();
    await new BotEngine(g.transport, 5000).ready();
    expect(g.posted).toContain(`setoption name UCI_Elo value ${BOT_MAX}`);
  });

  it('sends the position and a movetime search and returns the bestmove, not the pv move', async () => {
    const f = fake();
    const bot = new BotEngine(f.transport, 1500);
    const p = bot.bestMove(START, ['e2e4', 'e7e5'], { moveTimeMs: 700 });
    await tick();
    expect(f.posted.slice(-2)).toEqual([`position fen ${START} moves e2e4 e7e5`, 'go movetime 700']);
    f.say('info depth 12 multipv 1 score cp 30 pv g1f3 b8c6');
    f.say('bestmove b1c3 ponder g8f6');
    await expect(p).resolves.toBe('b1c3');
  });

  it('leaves out "moves" for the start position', async () => {
    const f = fake();
    const bot = new BotEngine(f.transport, 1500);
    void bot.bestMove(START, [], { moveTimeMs: 700 }).catch(() => {});
    await tick();
    expect(f.posted.slice(-2)[0]).toBe(`position fen ${START}`);
  });

  it('ignores the answer of a stopped search', async () => {
    const f = fake();
    const bot = new BotEngine(f.transport, 1500);
    const first = bot.bestMove(START, [], { moveTimeMs: 700 });
    first.catch(() => {});
    await tick();
    bot.stop();
    await expect(first).rejects.toSatisfy(isAbortError);
    expect(f.posted).toContain('stop');
    const second = bot.bestMove(START, ['d2d4'], { moveTimeMs: 700 });
    await tick();
    f.say('bestmove e2e4'); // answer of the stopped search
    let settled = false;
    void second.then(
      () => (settled = true),
      () => (settled = true),
    );
    await tick();
    expect(settled).toBe(false);
    f.say('bestmove d7d5');
    await expect(second).resolves.toBe('d7d5');
  });

  it('a stop before the handshake ends never sends a search', async () => {
    const f = fake();
    const bot = new BotEngine(f.transport, 1500);
    const p = bot.bestMove(START, [], { moveTimeMs: 700 });
    p.catch(() => {});
    bot.stop();
    await expect(p).rejects.toSatisfy(isAbortError);
    await tick();
    expect(f.posted.some((c) => c.startsWith('go '))).toBe(false);
    expect(f.posted).not.toContain('stop');
  });

  it('rejects when the engine reports an error', async () => {
    const f = fake();
    const bot = new BotEngine(f.transport, 1500);
    const p = bot.bestMove(START, [], { moveTimeMs: 700 });
    p.catch(() => {});
    await tick();
    f.crash('worker failed');
    await expect(p).rejects.toThrow('worker failed');
    await expect(bot.bestMove(START, [], { moveTimeMs: 700 })).rejects.toThrow('worker failed');
  });

  it('rejects when there is no move', async () => {
    const f = fake();
    const bot = new BotEngine(f.transport, 1500);
    const p = bot.bestMove(START, [], { moveTimeMs: 700 });
    p.catch(() => {});
    await tick();
    f.say('bestmove (none)');
    await expect(p).rejects.toThrow('no move');
  });

  it('terminate rejects the search and closes the worker', async () => {
    const f = fake();
    const bot = new BotEngine(f.transport, 1500);
    const p = bot.bestMove(START, [], { moveTimeMs: 700 });
    p.catch(() => {});
    await tick();
    bot.terminate();
    await expect(p).rejects.toThrow('terminated');
    expect(f.isTerminated()).toBe(true);
  });

  it('a handshake that fails rejects ready()', async () => {
    const f = fake();
    const bot = new BotEngine({ ...f.transport, post: () => {} }, 1500);
    const r = bot.ready();
    r.catch(() => {});
    f.crash('no engine');
    await expect(r).rejects.toThrow('no engine');
  });
});
