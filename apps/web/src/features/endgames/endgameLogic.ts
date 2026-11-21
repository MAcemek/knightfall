import type { Chess } from 'chess.js';
import type { TbCategory, TbMove } from '../../shared/tablebase.ts';
import type { EndgameGoal } from './positions.ts';

export const OFFLINE_MESSAGE = 'Endgame drills need an internet connection';

/** Worst to best, as seen by the side that is choosing. */
const RANK: TbCategory[] = ['unknown', 'loss', 'maybe-loss', 'blessed-loss', 'draw', 'maybe-win', 'cursed-win', 'win'];

const rank = (c: TbCategory) => RANK.indexOf(c);

/** Plies to the end of the game as the tablebase counts them (mate distance when it has one, else the 50-move counter). */
const distance = (m: TbMove) => Math.abs(m.dtm ?? m.dtz ?? 0);

/**
 * The reply of the tablebase side. It takes the best result it can get:
 * a winning side converts as fast as possible, a drawing side keeps the draw, and a losing side holds out
 * as long as possible. Returns null when there is no legal move.
 */
export function pickDefence(moves: readonly TbMove[]): TbMove | null {
  let best = -1;
  for (const m of moves) best = Math.max(best, rank(m.category));
  const top = moves.filter((m) => rank(m.category) === best);
  const first = top[0];
  if (!first) return null;
  if (best >= rank('maybe-win')) return top.reduce((a, b) => (distance(b) < distance(a) ? b : a));
  if (best <= rank('maybe-loss')) return top.reduce((a, b) => (distance(b) > distance(a) ? b : a));
  return first;
}

export type MoveJudgement = { ok: true } | { ok: false; message: string };

/**
 * Whether the user's move keeps the goal alive. `categoryAfter` is the result for the user after the move.
 * A win must stay a (non-cursed) win; a draw must not turn into a loss.
 */
export function judgeUserMove(goal: EndgameGoal, categoryAfter: TbCategory): MoveJudgement {
  const kept = goal === 'win' ? categoryAfter === 'win' : categoryAfter !== 'loss' && categoryAfter !== 'maybe-loss' && categoryAfter !== 'unknown';
  if (kept) return { ok: true };
  return { ok: false, message: `That lets it slip: it's now ${describeCategory(categoryAfter)}` };
}

function describeCategory(c: TbCategory): string {
  switch (c) {
    case 'draw':
      return 'a draw';
    case 'cursed-win':
      return 'only a draw by the 50-move rule';
    case 'maybe-win':
      return 'no longer a clear win';
    case 'loss':
    case 'maybe-loss':
      return 'lost';
    case 'blessed-loss':
      return 'a draw by the 50-move rule';
    default:
      return 'unclear';
  }
}

/**
 * Whether the drill is over, judged on the board after a move.
 * win: checkmate. draw: stalemate, insufficient material, repetition, the 50-move rule, or `holdMoves` of your moves.
 */
export function goalReached(goal: EndgameGoal, chess: Chess, userMoves: number, holdMoves: number | undefined): boolean {
  if (goal === 'win') return chess.isCheckmate();
  return (
    chess.isStalemate() ||
    chess.isInsufficientMaterial() ||
    chess.isThreefoldRepetition() ||
    chess.isDrawByFiftyMoves() ||
    (holdMoves !== undefined && userMoves >= holdMoves)
  );
}

export interface EndgameResult {
  solved: boolean;
  /** Fewest of your moves it took. */
  best: number;
}
export type EndgameProgress = Record<string, EndgameResult>;

export function sanitizeProgress(raw: unknown): EndgameProgress {
  const out: EndgameProgress = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    if (r.solved === true && typeof r.best === 'number' && Number.isInteger(r.best) && r.best > 0) out[id] = { solved: true, best: r.best };
  }
  return out;
}

export function recordSolve(progress: EndgameProgress, id: string, moves: number): EndgameProgress {
  const prev = progress[id];
  return { ...progress, [id]: { solved: true, best: prev ? Math.min(prev.best, moves) : moves } };
}

export function solvedCount(progress: EndgameProgress, ids: readonly string[]): number {
  return ids.filter((id) => progress[id]?.solved).length;
}
