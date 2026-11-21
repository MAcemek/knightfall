/**
 * Lichess endgame tablebase (https://tablebase.lichess.ovh, Syzygy up to 7 pieces).
 * One question per position: "standard?fen=..." answers with the result for the side to move and the result of
 * each legal move. Requests run one at a time, answers are cached, and a 429 pauses all requests for a while.
 */

export type TbCategory = 'win' | 'maybe-win' | 'cursed-win' | 'draw' | 'blessed-loss' | 'maybe-loss' | 'loss' | 'unknown';

export interface TbMove {
  uci: string;
  san: string;
  /** Result for the side that plays this move. (The API reports it for the opponent; it is flipped here.) */
  category: TbCategory;
  /** As the API gives them: seen by the side to move after the move, so negative when the mover is winning. */
  dtm: number | null;
  dtz: number | null;
}

export interface TbPosition {
  /** Result for the side to move. */
  category: TbCategory;
  dtm: number | null;
  dtz: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficientMaterial: boolean;
  /** Best first for the side to move. Empty when the game is over. */
  moves: TbMove[];
}

export type TablebaseFailure = 'offline' | 'rate-limited' | 'bad-response';

export class TablebaseError extends Error {
  readonly reason: TablebaseFailure;
  constructor(reason: TablebaseFailure) {
    super(`Tablebase lookup failed: ${reason}`);
    this.reason = reason;
  }
}

const OPPOSITE: Record<TbCategory, TbCategory> = {
  win: 'loss',
  'maybe-win': 'maybe-loss',
  'cursed-win': 'blessed-loss',
  draw: 'draw',
  'blessed-loss': 'cursed-win',
  'maybe-loss': 'maybe-win',
  loss: 'win',
  unknown: 'unknown',
};

/** The same result seen from the other side of the board. */
export function flipCategory(c: TbCategory): TbCategory {
  return OPPOSITE[c];
}

function asCategory(v: unknown): TbCategory | null {
  return typeof v === 'string' && v in OPPOSITE ? (v as TbCategory) : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parsePosition(raw: unknown): TbPosition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const category = asCategory(o.category);
  if (!category || !Array.isArray(o.moves)) return null;
  const moves: TbMove[] = [];
  for (const m of o.moves) {
    if (typeof m !== 'object' || m === null) return null;
    const r = m as Record<string, unknown>;
    const after = asCategory(r.category);
    if (typeof r.uci !== 'string' || typeof r.san !== 'string' || !after) return null;
    moves.push({ uci: r.uci, san: r.san, category: flipCategory(after), dtm: asNumber(r.dtm), dtz: asNumber(r.dtz) });
  }
  return {
    category,
    dtm: asNumber(o.dtm),
    dtz: asNumber(o.dtz),
    checkmate: o.checkmate === true,
    stalemate: o.stalemate === true,
    insufficientMaterial: o.insufficient_material === true,
    moves,
  };
}

export interface TablebaseOptions {
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
  /** How long to stay quiet after the server answers 429. */
  backoffMs?: number;
}

const ENDPOINT = 'https://tablebase.lichess.ovh/standard';

/** Board, side to move, castling and en passant: the part of a FEN the answer depends on. */
const positionKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

export function createTablebase(opts: TablebaseOptions = {}) {
  const fetchFn = opts.fetchFn ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const backoffMs = opts.backoffMs ?? 60_000;
  const cache = new Map<string, TbPosition>();
  let blockedUntil = 0;
  let queue: Promise<unknown> = Promise.resolve();

  async function request(fen: string): Promise<TbPosition> {
    if (now() < blockedUntil) throw new TablebaseError('rate-limited');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(`${ENDPOINT}?fen=${encodeURIComponent(fen)}`, { signal: controller.signal });
    } catch {
      throw new TablebaseError('offline');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) {
      blockedUntil = now() + backoffMs;
      throw new TablebaseError('rate-limited');
    }
    if (res.status >= 500) throw new TablebaseError('offline');
    if (!res.ok) throw new TablebaseError('bad-response');
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new TablebaseError('bad-response');
    }
    const parsed = parsePosition(json);
    if (!parsed) throw new TablebaseError('bad-response');
    return parsed;
  }

  return {
    lookup(fen: string): Promise<TbPosition> {
      const key = positionKey(fen);
      const hit = cache.get(key);
      if (hit) return Promise.resolve(hit);
      const run = queue.then(async () => {
        const again = cache.get(key);
        if (again) return again;
        const result = await request(fen);
        cache.set(key, result);
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

/** The app-wide instance: one queue and one cache for every drill. */
export const tablebase = createTablebase();
