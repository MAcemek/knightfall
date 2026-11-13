import { buildReport, type GameReport } from '@knightfall/core';
import type { ReportRequestInput, ReportWorkerReply, ReportWorkerRequest } from './reportWorker.ts';

/**
 * buildReport off the main thread. One lazily-created shared worker (kept alive), request ids, a promise map.
 * Falls back to buildReport on the main thread when Workers are unavailable (tests, SSR) or the worker fails.
 * The worker loads the opening table itself; only the fallback loads it here.
 */

export type { ReportRequestInput };

/** The slice of Worker this client uses (lets tests pass a fake). */
export interface ReportWorkerLike {
  postMessage(message: ReportWorkerRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<ReportWorkerReply>) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

/** undefined = not started yet, null = unavailable (no Worker support, or it crashed). */
let worker: ReportWorkerLike | null | undefined;
let nextRequest = 0;
const waiting = new Map<number, { resolve: (r: GameReport) => void; reject: (e: Error) => void }>();

let createWorker = (): ReportWorkerLike | null =>
  typeof Worker === 'undefined' ? null : (new Worker(new URL('./reportWorker.ts', import.meta.url), { type: 'module' }) as unknown as ReportWorkerLike);

let loadFallbackOpenings = async () => (await import('./store.ts')).loadOpenings();

function reportWorker(): ReportWorkerLike | null {
  if (worker !== undefined) return worker;
  try {
    worker = createWorker();
  } catch {
    worker = null;
  }
  const w = worker;
  if (w) {
    w.onmessage = (e) => {
      const p = waiting.get(e.data.id);
      if (!p) return;
      waiting.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.report);
      else p.reject(new Error(e.data.error));
    };
    w.onerror = () => {
      // The worker itself is broken: stop using it. Pending and later calls use the main thread.
      w.terminate();
      worker = null;
      for (const p of waiting.values()) p.reject(new Error('Report worker failed'));
      waiting.clear();
    };
  }
  return worker;
}

async function buildOnMainThread(input: ReportRequestInput): Promise<GameReport> {
  return buildReport({ ...input, openings: await loadFallbackOpenings() });
}

export function buildReportOffThread(input: ReportRequestInput): Promise<GameReport> {
  const w = reportWorker();
  if (!w) return buildOnMainThread(input);
  return new Promise<GameReport>((resolve, reject) => {
    const id = ++nextRequest;
    waiting.set(id, { resolve, reject });
    try {
      w.postMessage({ id, input });
    } catch (e) {
      waiting.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  }).catch(() => buildOnMainThread(input));
}

/** Test hook: replace the worker factory and the fallback openings loader, and reset all state. */
export function __resetReportClientForTests(opts: { createWorker?: () => ReportWorkerLike | null; loadOpenings?: typeof loadFallbackOpenings } = {}): void {
  worker = undefined;
  nextRequest = 0;
  waiting.clear();
  createWorker = opts.createWorker ?? (() => null);
  loadFallbackOpenings = opts.loadOpenings ?? (async () => null);
}
