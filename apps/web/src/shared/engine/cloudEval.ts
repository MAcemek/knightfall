import { Chess, type Square } from 'chess.js';
import { uciToMove, type EngineLine, type PositionEval } from '@knightfall/core';
import { MAX_PV } from './uci.ts';

/**
 * Lichess cloud evaluations: instant, deep evals for positions Lichess users have analysed before
 * (mostly openings). https://lichess.org/api#tag/Analysis/operation/apiCloudEval
 *
 * Rules respected here: one request at a time, a short timeout, and a pause after a 429.
 * Any miss (404, timeout, network error, too few lines) returns null and the caller uses the local engine.
 */

export const CLOUD_TIMEOUT_MS = 1500;
/** Only positions before this ply are looked up (later ones are almost never in the cloud). */
export const CLOUD_MAX_PLY = 30;
const PAUSE_AFTER_429_MS = 60_000;

type FetchFn = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const CASTLE: Record<string, string> = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' };

/**
 * Lichess prints castling as "king takes rook" (e1h1). Replay the line from the given FEN and rewrite those moves
 * to standard UCI (e1g1). The line is cut at the first move that is not legal, so the result always plays.
 */
export function normalisePv(fen: string, moves: readonly string[]): string[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of moves) {
    const uci = CASTLE[m] && chess.get(m.slice(0, 2) as Square)?.type === 'k' ? CASTLE[m] : m;
    try {
      chess.move(uciToMove(uci));
    } catch {
      break;
    }
    out.push(uci);
  }
  return out;
}

/** Convert a cloud-eval response body. Scores are already White-POV. Null when it is unusable. */
export function parseCloudEval(fen: string, body: unknown, minLines: number): PositionEval | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { depth?: unknown; pvs?: unknown };
  if (!Array.isArray(b.pvs)) return null;
  const lines: EngineLine[] = [];
  for (const raw of b.pvs) {
    if (typeof raw !== 'object' || raw === null) continue;
    const pv = raw as { moves?: unknown; cp?: unknown; mate?: unknown };
    if (typeof pv.moves !== 'string' || !pv.moves.trim()) continue;
    const moves = normalisePv(fen, pv.moves.trim().split(/\s+/).slice(0, MAX_PV));
    if (!moves.length) continue;
    if (typeof pv.mate === 'number' && pv.mate !== 0) lines.push({ score: { mate: pv.mate }, pv: moves });
    else if (typeof pv.cp === 'number') lines.push({ score: { cp: pv.cp }, pv: moves });
  }
  if (lines.length < Math.max(1, minLines)) return null;
  return { fen, depth: typeof b.depth === 'number' ? b.depth : 0, source: 'cloud', lines, score: lines[0].score };
}

export interface CloudEvalClient {
  /**
   * @param minLines  reject answers with fewer lines (pass min(multiPv, number of legal moves))
   * @returns the evaluation, or null on any miss
   */
  get(fen: string, multiPv: number, minLines: number, signal?: AbortSignal): Promise<PositionEval | null>;
}

export function createCloudEval(fetchFn: FetchFn, now: () => number = Date.now, timeoutMs = CLOUD_TIMEOUT_MS): CloudEvalClient {
  let chain: Promise<unknown> = Promise.resolve();
  let pausedUntil = 0;

  async function request(fen: string, multiPv: number, minLines: number, signal?: AbortSignal): Promise<PositionEval | null> {
    if (signal?.aborted || now() < pausedUntil) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
      const res = await fetchFn(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (res.status === 429) pausedUntil = now() + PAUSE_AFTER_429_MS;
      if (!res.ok) return null;
      return parseCloudEval(fen, await res.json(), minLines);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    get(fen, multiPv, minLines, signal) {
      const next = chain.then(() => request(fen, multiPv, minLines, signal));
      chain = next.catch(() => null);
      return next;
    },
  };
}
