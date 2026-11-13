import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PositionEval } from '@knightfall/core';
import { analysePositions } from './analyseGame.ts';
import { createCloudEval, normalisePv, parseCloudEval, type CloudEvalClient } from './cloudEval.ts';
import { EnginePool, isAbortError, poolSize, type EvalJob } from './pool.ts';
import { parseBestMove, parseInfo, toWhitePov, UciEngine, type AnalyseOptions, type PoolEngine, type UciTransport } from './uci.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const MATED = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';

const evalOf = (fen: string, cp = 10): PositionEval => ({ fen, depth: 16, source: 'engine', lines: [{ score: { cp }, pv: ['e2e4'] }], score: { cp } });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('UCI parsing', () => {
  it('parses a real Stockfish info line', () => {
    const line = 'info depth 16 seldepth 20 multipv 3 score cp 20 nodes 352089 nps 166158 hashfull 129 time 2119 pv d2d4 g8f6 c2c4';
    expect(parseInfo(line)).toEqual({ depth: 16, multipv: 3, score: { cp: 20 }, pv: ['d2d4', 'g8f6', 'c2c4'] });
  });
  it('parses mate scores and bounds', () => {
    expect(parseInfo('info depth 5 multipv 1 score mate -3 nodes 1 pv a1a2')).toMatchObject({ score: { mate: -3 } });
    expect(parseInfo('info depth 9 multipv 1 score cp 31 lowerbound nodes 1 pv e2e4')).toMatchObject({ bound: 'lower' });
    expect(parseInfo('info depth 9 multipv 1 score cp 31 upperbound nodes 1 pv e2e4')).toMatchObject({ bound: 'upper' });
  });
  it('defaults multipv to 1 and ignores other lines', () => {
    expect(parseInfo('info depth 3 score cp 5 pv e2e4')).toMatchObject({ multipv: 1 });
    expect(parseInfo('info depth 3 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeNull();
    expect(parseInfo('bestmove e2e4')).toBeNull();
    expect(parseInfo('info depth 3 score cp x pv e2e4')).toBeNull();
  });
  it('parses bestmove', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
    expect(parseBestMove('bestmove (none)')).toBeNull();
    expect(parseBestMove('info depth 1')).toBeUndefined();
  });
  it('flips scores for Black to move', () => {
    expect(toWhitePov({ cp: 30 }, 'w')).toEqual({ cp: 30 });
    expect(toWhitePov({ cp: 30 }, 'b')).toEqual({ cp: -30 });
    expect(toWhitePov({ mate: 2 }, 'b')).toEqual({ mate: -2 });
  });
});

/** Scripted engine: answers the handshake, and for every "go" plays back `script` (or waits for "stop"). */
function fakeTransport(script: string[] = []) {
  let listener: (line: string) => void = () => {};
  const sent: string[] = [];
  const transport: UciTransport = {
    post(cmd) {
      sent.push(cmd);
      queueMicrotask(() => {
        if (cmd === 'uci') listener('uciok');
        else if (cmd === 'isready') listener('readyok');
        else if (cmd.startsWith('go depth')) script.forEach((l) => listener(l));
        else if (cmd === 'stop') listener('bestmove e2e4');
      });
    },
    onLine: (l) => {
      listener = l;
    },
    onError: () => {},
    terminate: () => sent.push('<terminate>'),
  };
  return { transport, sent, emit: (line: string) => listener(line) };
}

describe('UciEngine', () => {
  it('handshakes, sets MultiPV, and returns White-POV lines sorted by multipv', async () => {
    const f = fakeTransport([
      'info depth 15 multipv 1 score cp -20 pv e7e5 g1f3',
      'info depth 16 multipv 2 score cp -35 pv c7c5',
      'info depth 16 multipv 1 score cp -28 pv e7e5 g1f3 b8c6',
      'info depth 16 multipv 3 score cp -40 upperbound pv e7e6',
      'bestmove e7e5 ponder g1f3',
    ]);
    const engine = new UciEngine(f.transport);
    const r = await engine.analyse(AFTER_E4, { depth: 16, multiPv: 3 });
    expect(f.sent).toEqual(['uci', 'isready', 'setoption name MultiPV value 3', `position fen ${AFTER_E4}`, 'go depth 16']);
    expect(r).toEqual({
      fen: AFTER_E4,
      depth: 16,
      source: 'engine',
      lines: [
        { score: { cp: 28 }, pv: ['e7e5', 'g1f3', 'b8c6'] },
        { score: { cp: 35 }, pv: ['c7c5'] },
        { score: { cp: 40 }, pv: ['e7e6'] },
      ],
      score: { cp: 28 },
    });
    expect(engine.busy).toBe(false);
  });
  it('does not resend MultiPV when unchanged and reports progress once per depth', async () => {
    const f = fakeTransport(['info depth 1 multipv 1 score cp 10 pv e2e4', 'info depth 1 multipv 1 score cp 11 pv e2e4', 'info depth 2 multipv 1 score cp 12 pv e2e4', 'bestmove e2e4']);
    const engine = new UciEngine(f.transport);
    const depths: number[] = [];
    await engine.analyse(START, { depth: 2, multiPv: 1, onUpdate: (e) => depths.push(e.depth) });
    await engine.analyse(START, { depth: 2, multiPv: 1 });
    expect(depths).toEqual([1, 2]);
    expect(f.sent.filter((c) => c.startsWith('setoption'))).toEqual([]);
  });
  it('sends ucinewgame and waits for readyok before a fresh search, and not otherwise', async () => {
    const f = fakeTransport(['info depth 16 multipv 1 score cp 10 pv e2e4', 'bestmove e2e4']);
    const engine = new UciEngine(f.transport);
    await engine.analyse(START, { depth: 16, multiPv: 2, fresh: true });
    expect(f.sent).toEqual(['uci', 'isready', 'ucinewgame', 'isready', 'setoption name MultiPV value 2', `position fen ${START}`, 'go depth 16']);
    f.sent.length = 0;
    await engine.analyse(START, { depth: 16, multiPv: 2 });
    expect(f.sent).toEqual([`position fen ${START}`, 'go depth 16']);
    f.sent.length = 0;
    await engine.analyse(START, { depth: 16, multiPv: 2, fresh: true });
    expect(f.sent).toEqual(['ucinewgame', 'isready', `position fen ${START}`, 'go depth 16']);
  });
  it('stop() ends an infinite search with what it has', async () => {
    const f = fakeTransport();
    const engine = new UciEngine(f.transport);
    const p = engine.analyse(START, { depth: 99, multiPv: 1, infinite: true });
    await tick();
    expect(f.sent.at(-1)).toBe('go infinite');
    f.emit('info depth 7 multipv 1 score cp 25 pv e2e4');
    engine.stop();
    const r = await p;
    expect(r.depth).toBe(7);
    expect(f.sent.at(-1)).toBe('stop');
  });
  it('rejects when the engine gives no lines, when busy, and after terminate', async () => {
    const f = fakeTransport(['bestmove (none)']);
    const engine = new UciEngine(f.transport);
    await expect(engine.analyse(MATED, { depth: 5, multiPv: 1 })).rejects.toThrow(/no evaluation/);
    const g = fakeTransport();
    const e2 = new UciEngine(g.transport);
    const running = e2.analyse(START, { depth: 99, multiPv: 1, infinite: true });
    await tick();
    await expect(e2.analyse(START, { depth: 5, multiPv: 1 })).rejects.toThrow(/busy/);
    e2.terminate();
    await expect(running).rejects.toThrow(/terminated/);
    await expect(e2.analyse(START, { depth: 5, multiPv: 1 })).rejects.toThrow(/terminated/);
    expect(g.sent.at(-1)).toBe('<terminate>');
  });
});

/** Engine whose searches are finished by the test. */
class ManualEngine implements PoolEngine {
  static all: ManualEngine[] = [];
  current: { fen: string; opts: AnalyseOptions; resolve: (e: PositionEval) => void; reject: (e: Error) => void } | null = null;
  stopped = 0;
  terminated = false;
  constructor() {
    ManualEngine.all.push(this);
  }
  analyse(fen: string, opts: AnalyseOptions): Promise<PositionEval> {
    return new Promise((resolve, reject) => {
      this.current = { fen, opts, resolve, reject };
    });
  }
  finish(cp = 0) {
    const c = this.current!;
    this.current = null;
    c.resolve(evalOf(c.fen, cp));
  }
  stop() {
    this.stopped++;
    if (this.current) this.finish();
  }
  terminate() {
    this.terminated = true;
  }
}

describe('EnginePool', () => {
  afterEach(() => {
    ManualEngine.all = [];
    vi.useRealTimers();
  });
  const make = (size: number, idleMs = 60_000) => new EnginePool({ size, create: () => new ManualEngine(), idleMs });
  const job = (fen: string, over: Partial<EvalJob> = {}): EvalJob => ({ fen, depth: 16, multiPv: 3, ...over });

  it('poolSize is clamp(cores - 1, 1, 4), 2 at most on mobile', () => {
    expect(poolSize(1, false)).toBe(1);
    expect(poolSize(2, false)).toBe(1);
    expect(poolSize(4, false)).toBe(3);
    expect(poolSize(16, false)).toBe(8);
    expect(poolSize(32, false)).toBe(8);
    expect(poolSize(8, true)).toBe(2);
    expect(poolSize(2, true)).toBe(1);
    expect(poolSize(undefined, false)).toBe(1);
  });
  it('creates engines lazily, up to its size, and queues the rest', async () => {
    const pool = make(2);
    expect(pool.stats).toEqual({ engines: 0, busy: 0, queued: 0 });
    const results = [pool.evaluate(job('a')), pool.evaluate(job('b')), pool.evaluate(job('c'))];
    expect(pool.stats).toEqual({ engines: 2, busy: 2, queued: 1 });
    ManualEngine.all[0].finish(1);
    expect((await results[0]).score).toEqual({ cp: 1 });
    await tick();
    expect(ManualEngine.all[0].current?.fen).toBe('c');
    ManualEngine.all[0].finish();
    ManualEngine.all[1].finish();
    await Promise.all(results);
    expect(ManualEngine.all).toHaveLength(2);
    pool.dispose();
  });
  it('runs higher priority first, then submission order', async () => {
    const pool = make(1);
    const order: string[] = [];
    const run = (fen: string, priority?: number) => pool.evaluate(job(fen, { priority })).then(() => order.push(fen));
    const all = [run('first'), run('low', -5), run('high', 9), run('mid-a', 1), run('mid-b', 1)];
    for (let i = 0; i < 5; i++) {
      ManualEngine.all[0].finish();
      await tick();
    }
    await Promise.all(all);
    expect(order).toEqual(['first', 'high', 'mid-a', 'mid-b', 'low']);
    pool.dispose();
  });
  it('cancels queued jobs without touching the engine and stops running ones', async () => {
    const pool = make(1);
    const a = new AbortController();
    const b = new AbortController();
    const running = pool.evaluate(job('run', { signal: a.signal }));
    const queued = pool.evaluate(job('wait', { signal: b.signal }));
    const after = pool.evaluate(job('after'));
    b.abort();
    await expect(queued).rejects.toSatisfy(isAbortError);
    expect(ManualEngine.all[0].stopped).toBe(0);
    a.abort();
    await expect(running).rejects.toSatisfy(isAbortError);
    expect(ManualEngine.all[0].stopped).toBe(1);
    await tick();
    expect(ManualEngine.all[0].current?.fen).toBe('after');
    ManualEngine.all[0].finish();
    await after;
    const pre = new AbortController();
    pre.abort();
    await expect(pool.evaluate(job('x', { signal: pre.signal }))).rejects.toSatisfy(isAbortError);
    pool.dispose();
  });
  it('terminates idle engines after the idle time and starts fresh ones on demand', async () => {
    vi.useFakeTimers();
    const pool = make(2, 60_000);
    const p = pool.evaluate(job('a'));
    ManualEngine.all[0].finish();
    await p;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(ManualEngine.all[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(ManualEngine.all[0].terminated).toBe(true);
    expect(pool.stats.engines).toBe(0);
    const q = pool.evaluate(job('b'));
    expect(ManualEngine.all).toHaveLength(2);
    ManualEngine.all[1].finish();
    await q;
    pool.dispose();
  });
  it('replaces an engine that failed and rejects that job', async () => {
    const pool = make(1);
    const bad = pool.evaluate(job('a'));
    ManualEngine.all[0].current!.reject(new Error('boom'));
    await expect(bad).rejects.toThrow('boom');
    expect(ManualEngine.all[0].terminated).toBe(true);
    const ok = pool.evaluate(job('b'));
    expect(ManualEngine.all).toHaveLength(2);
    ManualEngine.all[1].finish();
    await ok;
    pool.dispose();
  });
  it('dispose rejects everything and terminates engines', async () => {
    const pool = make(1);
    const a = pool.evaluate(job('a'));
    const b = pool.evaluate(job('b'));
    pool.dispose();
    await expect(a).rejects.toSatisfy(isAbortError);
    await expect(b).rejects.toSatisfy(isAbortError);
    expect(ManualEngine.all[0].terminated).toBe(true);
    await expect(pool.evaluate(job('c'))).rejects.toSatisfy(isAbortError);
  });
});

describe('cloud eval', () => {
  const body = { fen: AFTER_E4, knodes: 1, depth: 60, pvs: [{ moves: 'e7e5 g1f3 b8c6 f1b5 g8f6 e1h1', cp: 22 }, { moves: 'c7c6 d2d4', cp: 27 }, { moves: 'c7c5', mate: -9 }] };

  it('parses the response (scores already White-POV) and rewrites castling', () => {
    const r = parseCloudEval(AFTER_E4, body, 3)!;
    expect(r.source).toBe('cloud');
    expect(r.depth).toBe(60);
    expect(r.score).toEqual({ cp: 22 });
    expect(r.lines[0].pv).toEqual(['e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6', 'e1g1']);
    expect(r.lines[2].score).toEqual({ mate: -9 });
  });
  it('rejects answers with too few lines or junk', () => {
    expect(parseCloudEval(AFTER_E4, body, 4)).toBeNull();
    expect(parseCloudEval(AFTER_E4, { pvs: [] }, 1)).toBeNull();
    expect(parseCloudEval(AFTER_E4, { error: 'Not found' }, 1)).toBeNull();
    expect(parseCloudEval(AFTER_E4, null, 1)).toBeNull();
    expect(parseCloudEval(AFTER_E4, { pvs: [{ moves: 'a1a8', cp: 1 }] }, 1)).toBeNull();
  });
  it('normalisePv leaves real rook moves alone and cuts at an illegal move', () => {
    // A rook (not a king) on e1 moving to h1 stays e1h1.
    expect(normalisePv('4k3/8/8/8/8/8/8/K3R3 w - - 0 1', ['e1h1'])).toEqual(['e1h1']);
    expect(normalisePv('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1a1', 'e8h8'])).toEqual(['e1c1', 'e8g8']);
    expect(normalisePv(START, ['e2e4', 'e2e4', 'e7e5'])).toEqual(['e2e4']);
    expect(normalisePv('junk', ['e2e4'])).toEqual([]);
  });
  it('fetches one request at a time and encodes the FEN', async () => {
    let active = 0;
    let peak = 0;
    const urls: string[] = [];
    const client = createCloudEval(async (url) => {
      urls.push(url);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;
      return { ok: true, status: 200, json: async () => body };
    });
    const rs = await Promise.all([client.get(AFTER_E4, 3, 3), client.get(AFTER_E4, 3, 3), client.get(AFTER_E4, 3, 3)]);
    expect(peak).toBe(1);
    expect(rs.every((r) => r?.source === 'cloud')).toBe(true);
    expect(urls[0]).toBe(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(AFTER_E4)}&multiPv=3`);
  });
  it('returns null on 404, network errors and timeouts', async () => {
    expect(await createCloudEval(async () => ({ ok: false, status: 404, json: async () => ({}) })).get(START, 3, 3)).toBeNull();
    expect(await createCloudEval(async () => Promise.reject(new Error('offline'))).get(START, 3, 3)).toBeNull();
    const hang = createCloudEval((_, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))), Date.now, 15);
    expect(await hang.get(START, 3, 3)).toBeNull();
  });
  it('pauses for a minute after a 429', async () => {
    let t = 0;
    let calls = 0;
    const client = createCloudEval(async () => {
      calls++;
      return calls === 1 ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => body };
    }, () => t);
    expect(await client.get(AFTER_E4, 3, 3)).toBeNull();
    expect(await client.get(AFTER_E4, 3, 3)).toBeNull();
    expect(calls).toBe(1);
    t = 60_001;
    expect(await client.get(AFTER_E4, 3, 3)).not.toBeNull();
  });
});

describe('analysePositions', () => {
  const fens = [START, AFTER_E4, MATED];

  it('scores finished positions without an engine and streams progress', async () => {
    const seen: [number, number, number][] = [];
    const asked: EvalJob[] = [];
    const out = await analysePositions({
      fens,
      depth: 16,
      evaluate: async (j) => {
        asked.push(j);
        return evalOf(j.fen);
      },
      onEval: (i, _e, done, total) => seen.push([i, done, total]),
    });
    expect(out.map((e) => e.source)).toEqual(['engine', 'engine', 'terminal']);
    expect(out[2].terminal).toBe('checkmate');
    expect(asked.map((j) => j.fen)).toEqual([START, AFTER_E4]);
    expect(asked[0]).toMatchObject({ depth: 16, multiPv: 2, fresh: true });
    expect(asked[0].priority!).toBeGreaterThan(asked[1].priority!);
    expect(seen.map((s) => s[1])).toEqual([1, 2, 3]);
    expect(seen.every((s) => s[2] === 3)).toBe(true);
  });
  const cloudEvalAt = (fen: string, depth: number, lines: number): PositionEval => ({
    fen,
    depth,
    source: 'cloud',
    lines: Array.from({ length: lines }, (_, n) => ({ score: { cp: 10 + n }, pv: ['e2e4'] })),
    score: { cp: 10 },
  });
  it('accepts cloud evals in order, stops asking at the first miss and sends the rest to the engine', async () => {
    const asked: string[] = [];
    const many = [START, AFTER_E4, START, AFTER_E4, START];
    const cloud: CloudEvalClient = {
      get: async (fen) => {
        asked.push(fen);
        return asked.length <= 2 ? cloudEvalAt(fen, 40, 2) : null;
      },
    };
    const local: number[] = [];
    const out = await analysePositions({ fens: many, depth: 16, evaluate: async (j) => (local.push(1), evalOf(j.fen)), cloud });
    expect(out.map((e) => e.source)).toEqual(['cloud', 'cloud', 'engine', 'engine', 'engine']);
    expect(asked).toHaveLength(3); // third answer was the first miss; positions 4 and 5 were never asked
    expect(local).toHaveLength(3);
  });
  it('rejects a cloud answer shallower than the review depth and then never asks again', async () => {
    let calls = 0;
    const cloud: CloudEvalClient = { get: async (fen) => (calls++, calls === 1 ? cloudEvalAt(fen, 15, 2) : cloudEvalAt(fen, 60, 2)) };
    const out = await analysePositions({ fens: [START, AFTER_E4, START], depth: 16, evaluate: async (j) => evalOf(j.fen), cloud });
    expect(calls).toBe(1);
    expect(out.map((e) => e.source)).toEqual(['engine', 'engine', 'engine']);
    // exactly the review depth is accepted (deep builds use 20)
    const ok = await analysePositions({ fens: [START], depth: 20, evaluate: async (j) => evalOf(j.fen), cloud: { get: async (fen) => cloudEvalAt(fen, 20, 2) } });
    expect(ok[0].source).toBe('cloud');
    const shallowForDeep = await analysePositions({ fens: [START], depth: 20, evaluate: async (j) => evalOf(j.fen), cloud: { get: async (fen) => cloudEvalAt(fen, 19, 2) } });
    expect(shallowForDeep[0].source).toBe('engine');
  });
  it('asks the cloud for min(multiPv, legal moves) lines and skips terminal and known positions', async () => {
    const mins: number[] = [];
    const cloud: CloudEvalClient = { get: async (fen, _mpv, minLines) => (mins.push(minLines), cloudEvalAt(fen, 30, minLines)) };
    // A position with a single legal reply (Kg8).
    const oneMove = '7k/8/6K1/8/8/8/5R2/8 b - - 0 1';
    const known = [{ ...evalOf(START, 5) }, undefined, undefined, undefined];
    const out = await analysePositions({ fens: [START, AFTER_E4, oneMove, MATED], depth: 16, known, evaluate: async (j) => evalOf(j.fen), cloud });
    expect(mins).toEqual([2, 1]);
    expect(out.map((e) => e.source)).toEqual(['engine', 'cloud', 'cloud', 'terminal']);
  });
  it('uses the engine for everything when there is no cloud, each search from a clean hash', async () => {
    const jobs: EvalJob[] = [];
    await analysePositions({ fens: [START, AFTER_E4], depth: 16, evaluate: async (j) => (jobs.push(j), evalOf(j.fen)) });
    expect(jobs.every((j) => j.fresh === true && j.multiPv === 2)).toBe(true);
  });
  it('skips positions that are already known', async () => {
    let calls = 0;
    const known = [{ ...evalOf(START, 77) }, undefined, undefined];
    const out = await analysePositions({ fens, depth: 16, known, evaluate: async (j) => (calls++, evalOf(j.fen)) });
    expect(calls).toBe(1);
    expect(out[0].score).toEqual({ cp: 77 });
  });
  it('rejects with AbortError when aborted, before or during the run', async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(analysePositions({ fens, depth: 16, evaluate: async (j) => evalOf(j.fen), signal: pre.signal })).rejects.toSatisfy(isAbortError);
    const ctl = new AbortController();
    const pool = new EnginePool({ size: 1, create: () => new ManualEngine() });
    const p = analysePositions({ fens, depth: 16, evaluate: (j) => pool.evaluate(j), signal: ctl.signal });
    await tick();
    ctl.abort();
    await expect(p).rejects.toSatisfy(isAbortError);
    pool.dispose();
    ManualEngine.all = [];
  });
  it('propagates an engine failure', async () => {
    await expect(analysePositions({ fens, depth: 16, evaluate: async () => Promise.reject(new Error('engine died')) })).rejects.toThrow('engine died');
  });
});
