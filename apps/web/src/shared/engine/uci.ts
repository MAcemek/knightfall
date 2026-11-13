import type { EngineLine, EvalScore, PositionEval } from '@knightfall/core';

/**
 * UCI wrapper around one Stockfish worker.
 *
 * The engine (public/engine/stockfish-17.1-lite-single-03e3232.js, unmodified from npm stockfish@17.1.0) is a CLASSIC
 * worker that speaks UCI as plain strings: worker.postMessage('uci'), worker.onmessage = (e) => e.data is
 * one output line. It derives its .wasm URL from its own URL (".js" -> ".wasm"), so the two files must sit
 * next to each other and keep their names. Load it with a plain string URL: no { type: 'module' } and no
 * new URL(..., import.meta.url), or Vite would try to bundle it.
 *
 * Everything here is transport-agnostic so it runs in unit tests without a Worker.
 */

export interface UciTransport {
  post(command: string): void;
  /** Register the single line listener. */
  onLine(listener: (line: string) => void): void;
  /** Register the single fatal-error listener (worker failed to load or crashed). */
  onError(listener: (message: string) => void): void;
  terminate(): void;
}

/** Browser transport: a classic Web Worker at `url` (e.g. "/engine/stockfish-17.1-lite-single-03e3232.js"). */
export function workerTransport(url: string): UciTransport {
  const worker = new Worker(url);
  return {
    post: (command) => worker.postMessage(command),
    onLine: (listener) => {
      worker.onmessage = (e: MessageEvent) => {
        if (typeof e.data === 'string') listener(e.data);
      };
    },
    onError: (listener) => {
      worker.onerror = (e: ErrorEvent) => listener(e.message || 'The engine failed to load.');
    },
    terminate: () => worker.terminate(),
  };
}

/** One parsed "info ... pv ..." line. The score is from the SIDE TO MOVE's point of view, as the engine sends it. */
export interface UciInfo {
  depth: number;
  multipv: number;
  score: EvalScore;
  bound?: 'lower' | 'upper';
  pv: string[];
}

/** Parse an engine output line. Returns null for anything that is not a scored info line with a pv. */
export function parseInfo(line: string): UciInfo | null {
  if (!line.startsWith('info ') || !line.includes(' pv ') || !line.includes(' score ')) return null;
  const t = line.trim().split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: EvalScore | null = null;
  let bound: UciInfo['bound'];
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        depth = Number(t[++i]);
        break;
      case 'multipv':
        multipv = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const value = Number(t[++i]);
        if (!Number.isFinite(value)) return null;
        if (kind === 'cp') score = { cp: value };
        else if (kind === 'mate') score = { mate: value };
        else return null;
        break;
      }
      case 'lowerbound':
        bound = 'lower';
        break;
      case 'upperbound':
        bound = 'upper';
        break;
      case 'pv':
        pv = t.slice(i + 1);
        i = t.length;
        break;
      default:
        break;
    }
  }
  if (!score || !pv.length || !Number.isFinite(depth) || !Number.isFinite(multipv)) return null;
  return { depth, multipv, score, ...(bound ? { bound } : {}), pv };
}

/** "bestmove e2e4 ponder e7e5" -> "e2e4"; "bestmove (none)" -> null; any other line -> undefined. */
export function parseBestMove(line: string): string | null | undefined {
  if (!line.startsWith('bestmove')) return undefined;
  const move = line.split(/\s+/)[1];
  return !move || move === '(none)' ? null : move;
}

/** Engine scores are relative to the side to move; Knightfall stores them White-POV. */
export function toWhitePov(score: EvalScore, sideToMove: 'w' | 'b'): EvalScore {
  if (sideToMove === 'w') return score;
  return 'mate' in score ? { mate: -score.mate } : { cp: -score.cp };
}

/** Longest pv kept per line (enough for "show best line" and practice puzzles; keeps IndexedDB rows small). */
export const MAX_PV = 12;

export interface AnalyseOptions {
  /** Search depth. Ignored when `infinite`. */
  depth: number;
  multiPv: number;
  /** `go infinite`: runs until stop(). */
  infinite?: boolean;
  /** Send `ucinewgame` and wait for `readyok` first, so the search starts from a clean hash (deterministic reviews). */
  fresh?: boolean;
  /** Called (at most once per depth) with the evaluation so far. */
  onUpdate?: (current: PositionEval) => void;
}

/** What a pool needs from an engine (lets tests use a fake). */
export interface PoolEngine {
  analyse(fen: string, opts: AnalyseOptions): Promise<PositionEval>;
  stop(): void;
  terminate(): void;
}

const INIT_TIMEOUT_MS = 30_000;

interface Search {
  fen: string;
  side: 'w' | 'b';
  opts: AnalyseOptions;
  /** Latest info per multipv index. */
  best: Map<number, UciInfo>;
  lastDepthSent: number;
  resolve: (e: PositionEval) => void;
  reject: (e: Error) => void;
}

/**
 * One engine instance. Usage: `await engine.analyse(fen, { depth: 16, multiPv: 3 })`.
 * One search at a time (the pool guarantees that); stop() makes the running search finish early with
 * whatever it has. A search always ends on the engine's "bestmove", so the engine is idle afterwards.
 */
export class UciEngine implements PoolEngine {
  private readyPromise: Promise<void> | null = null;
  private waiters: { token: string; resolve: () => void }[] = [];
  private search: Search | null = null;
  private multiPv = 1;
  private dead: Error | null = null;

  constructor(private readonly transport: UciTransport) {
    transport.onLine((line) => this.onLine(line));
    transport.onError((message) => this.fail(new Error(message)));
  }

  get busy(): boolean {
    return this.search !== null;
  }

  /** Handshake (uci / isready). Called automatically by analyse(). */
  ready(): Promise<void> {
    this.readyPromise ??= new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The engine did not start. Check that /engine/ files are present (npm run engine).')), INIT_TIMEOUT_MS);
      void this.expect('uciok', 'uci')
        .then(() => this.expect('readyok', 'isready'))
        .then(() => {
          clearTimeout(timer);
          resolve();
        });
    });
    return this.readyPromise;
  }

  async analyse(fen: string, opts: AnalyseOptions): Promise<PositionEval> {
    if (this.dead) throw this.dead;
    if (this.search) throw new Error('Engine is busy');
    await this.ready();
    if (this.dead) throw this.dead;
    if (this.search) throw new Error('Engine is busy');
    if (opts.fresh) {
      this.transport.post('ucinewgame');
      await this.expect('readyok', 'isready');
      if (this.dead) throw this.dead;
      if (this.search) throw new Error('Engine is busy');
    }
    const multiPv = Math.max(1, Math.min(5, Math.round(opts.multiPv)));
    if (multiPv !== this.multiPv) {
      this.transport.post(`setoption name MultiPV value ${multiPv}`);
      this.multiPv = multiPv;
    }
    return new Promise<PositionEval>((resolve, reject) => {
      this.search = { fen, side: fen.split(' ')[1] === 'b' ? 'b' : 'w', opts, best: new Map(), lastDepthSent: 0, resolve, reject };
      this.transport.post(`position fen ${fen}`);
      this.transport.post(opts.infinite ? 'go infinite' : `go depth ${Math.max(1, Math.round(opts.depth))}`);
    });
  }

  /** Ask the running search to stop. Its promise still resolves (on "bestmove"). No-op when idle. */
  stop(): void {
    if (this.search) this.transport.post('stop');
  }

  terminate(): void {
    this.fail(new Error('Engine terminated'));
    this.transport.terminate();
  }

  private expect(token: string, command: string): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push({ token, resolve });
      this.transport.post(command);
    });
  }

  private fail(error: Error): void {
    if (this.dead) return;
    this.dead = error;
    const s = this.search;
    this.search = null;
    s?.reject(error);
  }

  private snapshot(s: Search): PositionEval | null {
    const lines: EngineLine[] = [...s.best.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, info]) => ({ score: toWhitePov(info.score, s.side), pv: info.pv.slice(0, MAX_PV) }));
    if (!lines.length) return null;
    const depth = Math.max(...[...s.best.values()].map((i) => i.depth));
    return { fen: s.fen, depth, source: 'engine', lines, score: lines[0].score };
  }

  private onLine(line: string): void {
    const waiter = this.waiters[0];
    if (waiter && line.trim() === waiter.token) {
      this.waiters.shift();
      waiter.resolve();
      return;
    }
    const s = this.search;
    if (!s) return;
    const info = parseInfo(line);
    if (info) {
      // Bound-only lines are provisional; keep the last exact score for that line unless there is none yet.
      if (!info.bound || !s.best.has(info.multipv)) s.best.set(info.multipv, info);
      if (s.opts.onUpdate && info.multipv === 1 && !info.bound && info.depth > s.lastDepthSent) {
        s.lastDepthSent = info.depth;
        const snap = this.snapshot(s);
        if (snap) s.opts.onUpdate(snap);
      }
      return;
    }
    if (parseBestMove(line) === undefined) return;
    this.search = null;
    const result = this.snapshot(s);
    if (result) s.resolve(result);
    else s.reject(new Error('The engine returned no evaluation for this position.'));
  }
}
