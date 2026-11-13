import { createCloudEval } from './cloudEval.ts';
import { EnginePool, poolSize } from './pool.ts';
import { UciEngine, workerTransport } from './uci.ts';

/** Which engine builds exist and the shared pools that run them (browser only). */

export type EngineId = 'lite' | 'deep';

export interface EngineInfo {
  id: EngineId;
  label: string;
  /** Worker script. Its .wasm sits next to it with the same base name. */
  url: string;
  /** Depth of a full game review. */
  depth: number;
}

export const ENGINES: Record<EngineId, EngineInfo> = {
  lite: { id: 'lite', label: 'Stockfish 17 Lite', url: '/engine/stockfish-17.1-lite-single-03e3232.js', depth: 16 },
  deep: { id: 'deep', label: 'Stockfish 17', url: '/engine/deep/stockfish-17.1-single-a496a04.js', depth: 20 },
};

/** Identifier stored with analyses: engine build + search settings family. Bump when results are no longer comparable. */
export const ENGINE_BUILD = 'sf17.1';

/**
 * Engine lines per position in a game review (matches WintrChess: MultiPV 2). The second line is what tells
 * "great" (the only good move) from "best".
 */
export const REVIEW_MULTIPV = 2;

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

const pools = new Map<EngineId, EnginePool>();

/** The shared pool for an engine build. Created on first use; only one build is kept alive at a time. */
export function getEnginePool(id: EngineId): EnginePool {
  let pool = pools.get(id);
  if (!pool) {
    for (const [other, p] of pools) {
      if (other !== id) {
        p.dispose();
        pools.delete(other);
      }
    }
    // The deep build needs ~100 MB per engine: never run more than two of them.
    const size = poolSize(navigator.hardwareConcurrency, isMobileDevice());
    pool = new EnginePool({ size: id === 'deep' ? Math.min(2, size) : size, create: () => new UciEngine(workerTransport(ENGINES[id].url)) });
    pools.set(id, pool);
  }
  return pool;
}

export function disposeEnginePools(): void {
  for (const p of pools.values()) p.dispose();
  pools.clear();
}

let deepProbe: Promise<boolean> | null = null;

/**
 * True when the optional deep build was fetched (`npm run engine:deep`). A HEAD request is not enough on
 * its own: the dev server answers unknown paths with index.html, so the content type is checked too.
 */
export function deepEngineAvailable(): Promise<boolean> {
  deepProbe ??= fetch(ENGINES.deep.url, { method: 'HEAD' })
    .then((r) => r.ok && /javascript/i.test(r.headers.get('content-type') ?? ''))
    .catch(() => false);
  return deepProbe;
}

/** Shared Lichess cloud-eval client (serial; see cloudEval.ts). */
export const cloudEval = createCloudEval((url, init) => fetch(url, init));
