import type { PositionEval } from '@knightfall/core';
import type { PoolEngine } from './uci.ts';

/**
 * A small pool of single-threaded engines. Jobs wait in a priority queue; each engine runs one job at a
 * time, so N engines analyse N positions in parallel while the page stays responsive (all search work
 * happens in Web Workers). Engines are created lazily and terminated after sitting idle.
 */

export interface EvalJob {
  fen: string;
  depth: number;
  multiPv: number;
  /** Higher runs first. Equal priorities run in submission order. Default 0. */
  priority?: number;
  /** Abort to drop a queued job or stop a running one; the promise then rejects with AbortError. */
  signal?: AbortSignal;
  /** Search until aborted (exploration mode). */
  infinite?: boolean;
  /** Start from a clean hash (`ucinewgame` + `isready`) so the result does not depend on earlier searches. */
  fresh?: boolean;
  onUpdate?: (current: PositionEval) => void;
}

export class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/** Engines to run: one core is left for the UI, at most 8 (each lite engine is a few tens of MB); phones get 2 at most (heat and memory). */
export function poolSize(hardwareConcurrency: number | undefined, mobile: boolean): number {
  const cores = Number.isFinite(hardwareConcurrency) && hardwareConcurrency ? hardwareConcurrency : 2;
  const size = Math.max(1, Math.min(8, cores - 1));
  return mobile ? Math.min(2, size) : size;
}

export const POOL_IDLE_MS = 60_000;

interface Queued {
  job: EvalJob;
  seq: number;
  resolve: (e: PositionEval) => void;
  reject: (e: Error) => void;
  onAbort: (() => void) | null;
}

interface Slot {
  engine: PoolEngine;
  running: Queued | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export interface PoolOptions {
  size: number;
  create: () => PoolEngine;
  idleMs?: number;
}

export class EnginePool {
  private readonly slots: Slot[] = [];
  private readonly queue: Queued[] = [];
  private seq = 0;
  private disposed = false;
  private readonly idleMs: number;

  constructor(private readonly opts: PoolOptions) {
    this.idleMs = opts.idleMs ?? POOL_IDLE_MS;
  }

  get stats(): { engines: number; busy: number; queued: number } {
    return { engines: this.slots.length, busy: this.slots.filter((s) => s.running).length, queued: this.queue.length };
  }

  /** Evaluate one position. Rejects with AbortError when `job.signal` aborts or the pool is disposed. */
  evaluate(job: EvalJob): Promise<PositionEval> {
    if (this.disposed || job.signal?.aborted) return Promise.reject(new AbortError());
    return new Promise<PositionEval>((resolve, reject) => {
      const item: Queued = { job, seq: this.seq++, resolve, reject, onAbort: null };
      if (job.signal) {
        item.onAbort = () => this.abort(item);
        job.signal.addEventListener('abort', item.onAbort, { once: true });
      }
      this.queue.push(item);
      this.pump();
    });
  }

  /** Terminate every engine and reject everything queued or running. The pool cannot be used afterwards. */
  dispose(): void {
    this.disposed = true;
    for (const item of this.queue.splice(0)) this.settle(item, null, new AbortError());
    for (const slot of this.slots.splice(0)) {
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      const running = slot.running;
      slot.running = null;
      if (running) this.settle(running, null, new AbortError());
      slot.engine.terminate();
    }
  }

  private settle(item: Queued, value: PositionEval | null, error: Error | null): void {
    if (item.onAbort) item.job.signal?.removeEventListener('abort', item.onAbort);
    item.onAbort = null;
    if (value) item.resolve(value);
    else item.reject(error ?? new AbortError());
  }

  private abort(item: Queued): void {
    const i = this.queue.indexOf(item);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.settle(item, null, new AbortError());
      return;
    }
    // Running: ask the engine to stop. run() rejects the job once the engine has really finished.
    const slot = this.slots.find((s) => s.running === item);
    slot?.engine.stop();
  }

  private takeNext(): Queued | undefined {
    if (!this.queue.length) return undefined;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i];
      const b = this.queue[best];
      const pa = a.job.priority ?? 0;
      const pb = b.job.priority ?? 0;
      if (pa > pb || (pa === pb && a.seq < b.seq)) best = i;
    }
    return this.queue.splice(best, 1)[0];
  }

  private pump(): void {
    if (this.disposed) return;
    while (this.queue.length) {
      let slot = this.slots.find((s) => !s.running);
      if (!slot && this.slots.length < this.opts.size) {
        slot = { engine: this.opts.create(), running: null, idleTimer: null };
        this.slots.push(slot);
      }
      if (!slot) return;
      const item = this.takeNext();
      if (!item) return;
      void this.run(slot, item);
    }
  }

  private async run(slot: Slot, item: Queued): Promise<void> {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = null;
    slot.running = item;
    const { job } = item;
    let value: PositionEval | null = null;
    let error: Error | null = null;
    let broken = false;
    try {
      value = await slot.engine.analyse(job.fen, { depth: job.depth, multiPv: job.multiPv, infinite: job.infinite, fresh: job.fresh, onUpdate: job.onUpdate });
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
      broken = true;
    }
    if (slot.running !== item) return; // disposed while running
    slot.running = null;
    if (job.signal?.aborted) this.settle(item, null, new AbortError());
    else this.settle(item, value, error);
    if (broken) {
      // A crashed engine is replaced lazily by the next pump().
      const i = this.slots.indexOf(slot);
      if (i >= 0) this.slots.splice(i, 1);
      slot.engine.terminate();
    } else if (!this.queue.length) {
      slot.idleTimer = setTimeout(() => {
        const i = this.slots.indexOf(slot);
        if (i < 0 || slot.running) return;
        this.slots.splice(i, 1);
        slot.engine.terminate();
      }, this.idleMs);
    }
    this.pump();
  }
}
