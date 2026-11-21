/**
 * Board vision drills (unrated): pure rules shared by the drill screens. No React, no storage.
 *
 * Squares are numbers 0..63 with a1 = 0, b1 = 1, ... h1 = 7, a2 = 8, ... h8 = 63.
 */

export type VisionDrill = 'find' | 'name' | 'knight';
export type VisionColor = 'w' | 'b';
/** Random source in [0, 1). Math.random in the app, a seeded one in tests. */
export type Rng = () => number;

export const FILES = 'abcdefgh';

export const DRILLS: Record<VisionDrill, { title: string; blurb: string; how: string; durationMs: number }> = {
  find: {
    title: 'Find the square',
    blurb: 'A square is named. Tap it on the board.',
    how: 'A square name appears above the board. Tap that square as fast as you can. The board has no coordinates.',
    durationMs: 30_000,
  },
  name: {
    title: 'Name the square',
    blurb: 'A square lights up. Pick its name.',
    how: 'One square lights up. Tap its name from the four choices under the board.',
    durationMs: 30_000,
  },
  knight: {
    title: 'Knight routes',
    blurb: 'Hop the knight to the flag in as few moves as you can.',
    how: 'Tap squares to move the knight one jump at a time until it reaches the flag. Reaching it in the fewest possible moves counts as perfect.',
    durationMs: 60_000,
  },
};

export const DRILL_ORDER: readonly VisionDrill[] = ['find', 'name', 'knight'];

export function isDrill(v: string | undefined): v is VisionDrill {
  return v === 'find' || v === 'name' || v === 'knight';
}

export function parseColor(v: string | null | undefined): VisionColor {
  return v === 'b' ? 'b' : 'w';
}

export const fileOf = (sq: number) => sq % 8;
export const rankOf = (sq: number) => Math.floor(sq / 8);
export const squareName = (sq: number) => `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;

export function parseSquare(name: string): number | null {
  const m = /^([a-h])([1-8])$/.exec(name.trim().toLowerCase());
  if (!m) return null;
  return FILES.indexOf(m[1]) + (Number(m[2]) - 1) * 8;
}

/** a1 is dark. */
export const isLightSquare = (sq: number) => (fileOf(sq) + rankOf(sq)) % 2 === 1;

/** The 64 squares in screen order (top-left first, row by row) for a board seen from `orientation`. */
export function screenSquares(orientation: VisionColor): number[] {
  const out: number[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      out.push(orientation === 'w' ? (7 - row) * 8 + col : row * 8 + (7 - col));
    }
  }
  return out;
}

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/** A random square, different from `avoid` when given (so the same prompt never repeats back to back). */
export function randomSquare(rng: Rng, avoid?: number): number {
  for (;;) {
    const sq = Math.min(63, Math.floor(rng() * 64));
    if (sq !== avoid) return sq;
  }
}

function shuffle<T>(rng: Rng, list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Answer choices for "Name the square": the answer plus near misses that a player who half-knows the board
 * would pick (the square mirrored top to bottom or left to right, a neighbour, the same file or rank),
 * shuffled. Always `count` distinct squares, the answer among them.
 */
export function nameChoices(rng: Rng, answer: number, count = 4): number[] {
  const f = fileOf(answer);
  const r = rankOf(answer);
  const near = new Set<number>();
  const add = (file: number, rank: number) => {
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) near.add(rank * 8 + file);
  };
  add(f, 7 - r);
  add(7 - f, r);
  add(f + 1, r);
  add(f - 1, r);
  add(f, r + 1);
  add(f, r - 1);
  near.delete(answer);
  const wrong = shuffle(rng, [...near]).slice(0, count - 1);
  while (wrong.length < count - 1) {
    const sq = randomSquare(rng);
    if (sq !== answer && !wrong.includes(sq)) wrong.push(sq);
  }
  return shuffle(rng, [answer, ...wrong]);
}

const KNIGHT_JUMPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
] as const;

export function knightMoves(sq: number): number[] {
  const f = fileOf(sq);
  const r = rankOf(sq);
  const out: number[] = [];
  for (const [df, dr] of KNIGHT_JUMPS) {
    const nf = f + df;
    const nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(nr * 8 + nf);
  }
  return out;
}

export const isKnightMove = (from: number, to: number) => knightMoves(from).includes(to);

/** Fewest knight moves from one square to another (breadth-first search). */
export function knightDistance(from: number, to: number): number {
  if (from === to) return 0;
  const dist = new Array<number>(64).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const next of knightMoves(cur)) {
      if (dist[next] !== -1) continue;
      dist[next] = dist[cur] + 1;
      if (next === to) return dist[next];
      queue.push(next);
    }
  }
  return -1; // unreachable on an 8x8 board, kept for safety
}

export interface KnightRoute {
  from: number;
  to: number;
  /** Fewest moves needed. */
  min: number;
}

/** A start and a target square between `minHops` and `maxHops` knight moves apart. */
export function knightRoute(rng: Rng, minHops = 2, maxHops = 4, avoidFrom?: number): KnightRoute {
  for (;;) {
    const from = randomSquare(rng, avoidFrom);
    const options: number[] = [];
    for (let to = 0; to < 64; to++) {
      const d = knightDistance(from, to);
      if (d >= minHops && d <= maxHops) options.push(to);
    }
    if (options.length) {
      const to = pick(rng, options);
      return { from, to, min: knightDistance(from, to) };
    }
  }
}

/** Time left in a run, never below zero. */
export function remainingMs(startedAt: number, now: number, durationMs: number): number {
  return Math.max(0, durationMs - (now - startedAt));
}

/** "0:27" style clock text; rounds up so the clock reads 0:01 until the very end. */
export function clockText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Share of correct answers in a run, as a whole percent, or null when nothing was answered. */
export function accuracyPercent(correct: number, misses: number): number | null {
  const total = correct + misses;
  return total ? Math.round((correct / total) * 100) : null;
}

/** Best score per drill and board side, keyed "find-w", "knight-b" and so on. */
export type VisionBests = Partial<Record<string, number>>;

export const bestKey = (drill: VisionDrill, color: VisionColor) => `${drill}-${color}`;

/** Keeps only well-formed entries from stored data (non-negative whole numbers under known keys). */
export function sanitizeBests(raw: unknown): VisionBests {
  const out: VisionBests = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const drill of DRILL_ORDER) {
    for (const color of ['w', 'b'] as const) {
      const key = bestKey(drill, color);
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[key] = v;
    }
  }
  return out;
}

/** Folds a finished run into the bests. `isNew` is true only for a real improvement on a score above zero. */
export function recordBest(bests: VisionBests, drill: VisionDrill, color: VisionColor, score: number): { bests: VisionBests; isNew: boolean; previous: number | null } {
  const key = bestKey(drill, color);
  const previous = bests[key] ?? null;
  if (score <= 0 || (previous !== null && score <= previous)) return { bests, isNew: false, previous };
  return { bests: { ...bests, [key]: score }, isNew: true, previous };
}
