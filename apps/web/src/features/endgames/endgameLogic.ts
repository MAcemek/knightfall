import { Chess } from 'chess.js';
import type { TablebaseFailure, TbCategory, TbMove } from '../../shared/tablebase.ts';
import type { EndgameGoal } from './positions.ts';

export const OFFLINE_MESSAGE = 'Endgame drills need an internet connection';

/** Why the tablebase did not answer, in words. */
export function failureMessage(reason: TablebaseFailure): string {
  if (reason === 'rate-limited') return 'Lichess is busy. Wait a minute, then try again.';
  if (reason === 'bad-response') return 'Lichess could not answer. Try again in a moment.';
  return OFFLINE_MESSAGE;
}

/** Worst to best, as seen by the side that is choosing. */
const RANK: TbCategory[] = ['unknown', 'loss', 'maybe-loss', 'blessed-loss', 'draw', 'maybe-win', 'cursed-win', 'win'];

const rank = (c: TbCategory) => RANK.indexOf(c);

/** Plies to the end of the game as the tablebase counts them (mate distance when it has one, else the 50-move counter). */
const distance = (m: TbMove) => Math.abs(m.dtm ?? m.dtz ?? 0);

/**
 * The reply of the tablebase side. It takes the best result it can get:
 * a winning side converts as fast as possible, a drawing side keeps the draw (and, given the board, makes it as
 * hard as it can), and a losing side holds out as long as possible. Returns null when there is no legal move.
 */
export function pickDefence(moves: readonly TbMove[], chess?: Chess): TbMove | null {
  let best = -1;
  for (const m of moves) best = Math.max(best, rank(m.category));
  const top = moves.filter((m) => rank(m.category) === best);
  const first = top[0];
  if (!first) return null;
  if (best >= rank('maybe-win')) return top.reduce((a, b) => (distance(b) < distance(a) ? b : a));
  if (best <= rank('maybe-loss')) return top.reduce((a, b) => (distance(b) > distance(a) ? b : a));
  if (!chess) return first;
  const seen = visits(chess);
  const scored = top.map((m) => ({ m, s: pressure(chess, m, seen) }));
  return scored.reduce((a, b) => (b.s > a.s ? b : a)).m;
}

/** The part of a FEN that repetition depends on. */
const positionKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/** How often each position has been on the board in this drill. */
function visits(chess: Chess): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of chess.history({ verbose: true })) out.set(positionKey(m.after), (out.get(positionKey(m.after)) ?? 0) + 1);
  return out;
}

/**
 * How much a drawing move tests the other side. The tablebase calls every drawing move equal, so without this the
 * attacker would happily give its last pawn away. Worst: ending the game; then giving up material, letting a pawn
 * promote, repeating, and pushing a pawn while there is something else to try.
 */
function pressure(chess: Chess, move: TbMove, seen: ReadonlyMap<string, number>): number {
  const c = new Chess(chess.fen());
  const played = c.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion: move.uci.slice(4) || undefined });
  if (c.isStalemate() || c.isInsufficientMaterial()) return -1000;
  const replies = c.moves({ verbose: true });
  let score = -replies.length;
  if (replies.some((r) => r.promotion)) score -= 100;
  for (const r of replies) {
    if (!r.captured) continue;
    const after = new Chess(r.after);
    if (after.isInsufficientMaterial()) score -= 500;
    else if (!after.moves({ verbose: true }).some((m) => m.to === r.to)) score -= 100;
  }
  score -= 60 * (seen.get(positionKey(played.after)) ?? 0);
  if (played.piece === 'p') score -= 40;
  return score;
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
