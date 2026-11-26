import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import { uciToMove } from '../validate.ts';
import { materialBalance } from './coach.ts';
import { expectedPoints, subjectiveValue } from './expectedPoints.ts';
import { captureSquare, isPieceSafe, PIECE_VALUE, unsafePieces, type BoardPiece } from './pieceSafety.ts';
import type { MoveClass, PositionEval, Side } from './types.ts';

/**
 * Move insights: WHY a move was good or bad, in data. Every motif is verified against the engine line (and, for
 * material claims, by replaying that line on the board); when nothing verifies, an eval-only fallback is used.
 * Pure. The sentences live in coach.ts.
 */

export type Motif =
  | 'allows-mate' | 'misses-mate' | 'hangs-piece' | 'misses-free-piece' | 'loses-material'
  | 'misses-material' | 'walks-into-fork' | 'lets-off-hook'
  | 'throws-win' | 'drifts'
  | 'sacrifice' | 'only-move' | 'wins-free-piece' | 'checkmate' | 'book' | 'forced' | 'none';

export type BestReason =
  | 'mates' | 'stops-mate' | 'wins-piece' | 'wins-material' | 'saves-piece' | 'defends' | 'castles'
  | 'develops' | 'trades-when-ahead' | 'keeps-advantage' | 'holds';

export interface MoveInsight {
  motif: Motif;
  /** The piece the sentence is about. */
  piece?: PieceSymbol;
  square?: Square;
  mateIn?: number;
  /** Points of material lost / missed. */
  material?: number;
  /** The opponent's punishing move (red arrow). */
  threat?: { from: Square; to: Square };
  /** The opponent's best reply, in SAN. */
  replySan?: string;
  best?: { reason: BestReason; piece?: PieceSymbol; square?: Square; mateIn?: number; material?: number };
}

export interface InsightContext {
  fenBefore: string;
  fenAfter: string;
  /** The move played (UCI). */
  uci: string;
  mover: Side;
  class: MoveClass;
  /** Position before / after the move, with PVs (scores are White's view, PVs are UCI). */
  evalBefore: PositionEval;
  evalAfter: PositionEval;
  /** Where the opponent's previous move captured: taking back there is not winning something for free. */
  lastCapture?: Square;
  /** Name of the opening when the position is a known one (informational). */
  opening?: string | null;
}

const BAD: ReadonlySet<MoveClass> = new Set<MoveClass>(['inaccuracy', 'mistake', 'miss', 'blunder']);
/** Material (points) a claim needs before it is made. */
const MIN_SWING = 2;
const PV_PLIES = 4;

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w');
const isMateScore = (s: PositionEval['score']): s is { mate: number } => 'mate' in s;

function sqOf(from: string, to: string): { from: Square; to: Square } {
  return { from: from as Square, to: to as Square };
}

/** Replays up to `plies` UCI moves; stops at the first illegal one. `sans` and `moves` have the same length. */
function replay(fen: string, pv: string[], plies: number): { fen: string; moves: Move[] } {
  const moves: Move[] = [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return { fen, moves };
  }
  for (const uci of pv.slice(0, plies)) {
    try {
      moves.push(chess.move(uciToMove(uci)));
    } catch {
      break;
    }
  }
  return { fen: chess.fen(), moves };
}

/** Number of plies to replay: capped at 4 and made even so the exchange ends on the side that moves second. */
function evenPlies(pvLength: number): number {
  const n = Math.min(PV_PLIES, pvLength);
  return n > 1 && n % 2 === 1 ? n - 1 : n;
}

/** Material change for `side` between two positions (points, pawns included). */
function materialDelta(fenFrom: string, fenTo: string, side: Side): number {
  return (side === 'w' ? 1 : -1) * (materialBalance(fenTo) - materialBalance(fenFrom));
}

function tryMove(fen: string, uci: string): Move | null {
  try {
    return new Chess(fen).move(uciToMove(uci));
  } catch {
    return null;
  }
}

function moverEp(score: PositionEval['score'], mover: Side): number {
  const w = expectedPoints(score, mover);
  return mover === 'w' ? w : 1 - w;
}

function opponentPv(ctx: InsightContext): string[] {
  return ctx.evalAfter.lines[0]?.pv ?? [];
}

/* ---------- bad moves ---------- */

function badInsight(ctx: InsightContext, move: Move): MoveInsight {
  const { mover, fenBefore, fenAfter } = ctx;
  const afterScore = ctx.evalAfter.score;
  const beforeScore = ctx.evalBefore.score;
  const oppPv = opponentPv(ctx);

  // 1. Mates.
  if (isMateScore(afterScore) && subjectiveValue(afterScore, mover) < 0) {
    const reply = oppPv[0] ? tryMove(fenAfter, oppPv[0]) : null;
    return {
      motif: 'allows-mate',
      mateIn: Math.abs(afterScore.mate),
      ...(reply ? { replySan: reply.san, threat: sqOf(reply.from, reply.to) } : {}),
    };
  }
  if (isMateScore(beforeScore) && subjectiveValue(beforeScore, mover) > 0 && !(isMateScore(afterScore) && subjectiveValue(afterScore, mover) > 0)) {
    return { motif: 'misses-mate', mateIn: Math.abs(beforeScore.mate) };
  }

  // The opponent's best line, replayed (opponent first, so an even count ends on the mover's move).
  const opp = replay(fenAfter, oppPv, evenPlies(oppPv.length));
  const oppLoss = -materialDelta(fenBefore, opp.fen, mover);
  const firstReply = opp.moves[0];
  const replyInfo = firstReply
    ? { replySan: firstReply.san, threat: sqOf(firstReply.from, firstReply.to) }
    : {};

  // 2. A piece left (or put) where it can be taken, the opponent takes it, and the line costs >= 2 points.
  if (firstReply?.captured && oppLoss >= MIN_SWING) {
    const hit = captureSquare(firstReply);
    const piece = unsafePieces(fenAfter, mover, move).find((p) => p.square === hit && p.type === firstReply.captured);
    if (piece) return { motif: 'hangs-piece', piece: piece.type, square: piece.square, material: oppLoss, ...replyInfo };
  }

  // 3. The best move wins an unprotected piece that the played move left alone.
  const bestPv = ctx.evalBefore.lines[0]?.pv ?? [];
  const bestMove = bestPv[0] && bestPv[0] !== ctx.uci ? tryMove(fenBefore, bestPv[0]) : null;
  const best = replay(fenBefore, bestPv, evenPlies(bestPv.length));
  const bestGain = materialDelta(fenBefore, best.fen, mover);
  if (bestMove?.captured && bestMove.captured !== 'p' && bestGain >= MIN_SWING) {
    const victim: BoardPiece = { square: captureSquare(bestMove), type: bestMove.captured, color: other(mover) };
    const tookIt = !!move.captured && captureSquare(move) === victim.square;
    if (!tookIt && bestGain >= PIECE_VALUE[victim.type] && !isPieceSafe(fenBefore, victim)) {
      return { motif: 'misses-free-piece', piece: victim.type, square: victim.square, material: bestGain };
    }
  }

  // 5. Fork (checked before the general material rule, which would otherwise always win): the reply attacks two
  // or more of the mover's pieces (or king + piece) worth more than the forker, and the engine line collects one.
  const fork = fiveFork(ctx, opp, firstReply, oppLoss);
  if (fork) return fork;

  // 4. Material swings along the engine lines.
  if (oppLoss >= MIN_SWING) {
    // The red arrow must show a real threat: the opponent's first capture or check in the line, not a quiet
    // first reply such as castling. No such move, no arrow.
    const punish = opp.moves.find((m, i) => i % 2 === 0 && (!!m.captured || /[+#]/.test(m.san)));
    return {
      motif: 'loses-material',
      material: oppLoss,
      ...(firstReply?.captured ? { piece: firstReply.captured, square: captureSquare(firstReply) } : {}),
      ...(firstReply ? { replySan: firstReply.san } : {}),
      ...(punish ? { threat: sqOf(punish.from, punish.to) } : {}),
    };
  }
  if (bestGain >= MIN_SWING && bestGain + oppLoss >= MIN_SWING) {
    const first = best.moves[0];
    return {
      motif: 'misses-material',
      material: bestGain,
      ...(first?.captured ? { piece: first.captured, square: captureSquare(first) } : {}),
    };
  }

  // 6. A missed chance.
  if (ctx.class === 'miss') return { motif: 'lets-off-hook' };

  // 7. Eval fallbacks.
  if (moverEp(beforeScore, mover) >= 0.75 && moverEp(afterScore, mover) <= 0.6) return { motif: 'throws-win' };
  return { motif: 'drifts' };
}

/** Squares of the mover's pieces (and king, when checked) that the piece now on `reply.to` attacks and outvalues. */
function forkTargets(fenAfterReply: string, reply: Move, mover: Side): Square[] {
  let b: Chess;
  try {
    b = new Chess(fenAfterReply);
  } catch {
    return [];
  }
  const attacker = PIECE_VALUE[reply.piece];
  const out: Square[] = [];
  for (const row of b.board()) {
    for (const p of row) {
      if (!p || p.color !== mover) continue;
      const worth = p.type === 'k' ? Infinity : PIECE_VALUE[p.type];
      if (worth <= attacker) continue;
      if (b.attackers(p.square, other(mover)).includes(reply.to)) out.push(p.square);
    }
  }
  return out;
}

function fiveFork(
  ctx: InsightContext,
  opp: { fen: string; moves: Move[] },
  firstReply: Move | undefined,
  oppLoss: number,
): MoveInsight | null {
  if (!firstReply || firstReply.captured || firstReply.piece === 'k' || oppLoss < MIN_SWING) return null;
  const afterReply = replay(ctx.fenAfter, [firstReply.from + firstReply.to + (firstReply.promotion ?? '')], 1);
  const targets = forkTargets(afterReply.fen, firstReply, ctx.mover);
  if (targets.length < 2) return null;
  // The line must actually collect one of the forked pieces: an opponent capture later on lands on a target type.
  const typesAt = new Set<PieceSymbol>();
  try {
    const b = new Chess(afterReply.fen);
    for (const sq of targets) typesAt.add(b.get(sq)!.type);
  } catch {
    return null;
  }
  const collects = opp.moves.some((m, i) => i % 2 === 0 && i > 0 && !!m.captured && typesAt.has(m.captured));
  if (!collects) return null;
  return {
    motif: 'walks-into-fork',
    piece: firstReply.piece,
    square: firstReply.to,
    material: oppLoss,
    replySan: firstReply.san,
    threat: sqOf(firstReply.from, firstReply.to),
  };
}

/* ---------- the best move ---------- */

/** Why the engine's first choice is better. `deep` also runs the (costlier) piece-safety checks. */
function bestInsight(ctx: InsightContext, deep: boolean): MoveInsight['best'] | undefined {
  const { mover, fenBefore } = ctx;
  const line = ctx.evalBefore.lines[0];
  const bestUci = line?.pv[0];
  if (!line || !bestUci) return undefined;
  const bm = tryMove(fenBefore, bestUci);
  if (!bm) return undefined;

  if (isMateScore(line.score) && subjectiveValue(line.score, mover) > 0) return { reason: 'mates', mateIn: Math.abs(line.score.mate) };

  const seq = replay(fenBefore, line.pv, evenPlies(line.pv.length));
  const gain = materialDelta(fenBefore, seq.fen, mover);

  if (deep && bm.captured && bm.captured !== 'p' && gain >= MIN_SWING) {
    const victim: BoardPiece = { square: captureSquare(bm), type: bm.captured, color: other(mover) };
    if (!isPieceSafe(fenBefore, victim)) return { reason: 'wins-piece', piece: victim.type, square: victim.square, material: gain };
  }
  if (gain >= MIN_SWING) return { reason: 'wins-material', material: gain };

  if (deep) {
    const unsafe = unsafePieces(fenBefore, mover);
    if (unsafe.length) {
      let after: Chess | null = null;
      try {
        after = new Chess(fenBefore);
        after.move(uciToMove(bestUci));
      } catch {
        after = null;
      }
      if (after) {
        const afterFen = after.fen();
        const moved = unsafe.find((p) => p.square === bm.from);
        if (moved && isPieceSafe(afterFen, { ...moved, square: bm.to }, bm)) return { reason: 'saves-piece', piece: moved.type, square: bm.to };
        const kept = unsafe.find((p) => p.square !== bm.from && isPieceSafe(afterFen, p));
        if (kept) return { reason: 'defends', piece: kept.type, square: kept.square };
      }
    }
  }

  if (bm.isKingsideCastle() || bm.isQueensideCastle()) return { reason: 'castles' };
  const fullmove = Number(fenBefore.split(' ')[5]) || 1;
  const homeRank = mover === 'w' ? '1' : '8';
  if ((bm.piece === 'n' || bm.piece === 'b') && bm.from[1] === homeRank && bm.to[1] !== homeRank && fullmove <= 12 && !bm.captured) {
    return { reason: 'develops', piece: bm.piece, square: bm.to };
  }
  const ahead = (mover === 'w' ? 1 : -1) * materialBalance(fenBefore);
  if (bm.captured && bm.captured !== 'p' && PIECE_VALUE[bm.captured] >= PIECE_VALUE[bm.piece] && ahead >= MIN_SWING) {
    return { reason: 'trades-when-ahead' };
  }
  return { reason: moverEp(line.score, mover) >= 0.6 ? 'keeps-advantage' : 'holds' };
}

/* ---------- good moves ---------- */

function goodInsight(ctx: InsightContext, move: Move): MoveInsight {
  const { mover, fenBefore, fenAfter } = ctx;
  switch (ctx.class) {
    case 'book': return { motif: 'book' };
    case 'forced': return { motif: 'forced' };
    case 'brilliant': {
      const offered = unsafePieces(fenAfter, mover, move).sort((a, b) => PIECE_VALUE[b.type] - PIECE_VALUE[a.type])[0];
      return offered ? { motif: 'sacrifice', piece: offered.type, square: offered.square } : { motif: 'none' };
    }
    case 'great': return { motif: 'only-move' };
    default:
  }
  if (move.san.endsWith('#')) return { motif: 'checkmate' };
  if ((ctx.class === 'best' || ctx.class === 'excellent') && move.captured && move.captured !== 'p') {
    const victim: BoardPiece = { square: captureSquare(move), type: move.captured, color: other(mover) };
    if (victim.square !== ctx.lastCapture && !isPieceSafe(fenBefore, victim)) {
      // "Free" means the whole piece: nothing is given back in the opponent's best reply (and our recapture).
      const pv = opponentPv(ctx);
      const line = replay(fenAfter, pv, Math.min(2, pv.length));
      const net = materialDelta(fenBefore, line.fen, mover);
      if (net >= PIECE_VALUE[victim.type]) return { motif: 'wins-free-piece', piece: victim.type, square: victim.square, material: net };
    }
  }
  return { motif: 'none' };
}

function stopsMateOr(best: MoveInsight['best'] | undefined, alreadyMated: boolean): MoveInsight['best'] | undefined {
  if (!best) return undefined;
  // A mate already on the board is not stopped by the best move, only delayed: keep its own reason then.
  return best.reason === 'mates' || alreadyMated ? best : { reason: 'stops-mate' };
}

/** Why this move was good or bad. Never throws; returns { motif: 'none' } when there is nothing verified to say. */
export function moveInsight(ctx: InsightContext): MoveInsight {
  const move = tryMove(ctx.fenBefore, ctx.uci);
  if (!move) return { motif: 'none' };
  if (BAD.has(ctx.class)) {
    const insight = badInsight(ctx, move);
    // After a move that allows a forced mate, the point of the best move is not getting mated, whatever else
    // it happens to do (unless it mates first).
    const before = ctx.evalBefore.score;
    const alreadyMated = isMateScore(before) && subjectiveValue(before, ctx.mover) < 0;
    const best = insight.motif === 'allows-mate' ? stopsMateOr(bestInsight(ctx, true), alreadyMated) : bestInsight(ctx, true);
    return best ? { ...insight, best } : insight;
  }
  const insight = goodInsight(ctx, move);
  if (ctx.class === 'good' || ctx.class === 'excellent') {
    const best = bestInsight(ctx, ctx.class === 'excellent' && !!move.captured);
    if (best) return { ...insight, best };
  }
  return insight;
}
