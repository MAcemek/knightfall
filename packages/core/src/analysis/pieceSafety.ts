import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';

/**
 * Piece safety on a real board: who attacks a piece (including batteries), who defends it, whether it can
 * be won, whether taking it walks into a bigger counter-threat, and whether it is trapped. These drive the
 * "great" and "brilliant" classes. Behaviour follows WintrChess's documented rules; reimplemented here.
 */

export interface BoardPiece {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

/** A move described without a board (enough for chess.js to replay it). */
export interface PieceMove {
  piece: PieceSymbol;
  color: Color;
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: Infinity };

const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const moveKey = (m: PieceMove) => `${m.piece}${m.color}${m.from}${m.to}${m.promotion ?? ''}`;
const toPieceMove = (m: Move): PieceMove => ({ piece: m.piece, color: m.color, from: m.from, to: m.to, promotion: m.promotion });
/** Results are pure in their arguments and the same positions recur many times: memoise (bounded). */
const CACHE_LIMIT = 20000;
function memo<A extends unknown[], R>(fn: (...a: A) => R, key: (...a: A) => string): (...a: A) => R {
  const cache = new Map<string, R>();
  return (...a: A): R => {
    const k = key(...a);
    if (cache.has(k)) return cache.get(k)!;
    const r = fn(...a);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(k, r);
    return r;
  };
}
const pieceKey = (p: BoardPiece) => `${p.type}${p.color}${p.square}`;
const attackerPiece = (m: PieceMove): BoardPiece => ({ square: m.from, type: m.piece, color: m.color });

/** The FEN with `color` to move. The en-passant square is cleared when the turn changes. */
export function withTurn(fen: string, color: Color): string {
  const parts = fen.split(' ');
  if (parts[1] !== color) parts[3] = '-';
  parts[1] = color;
  return parts.join(' ');
}

function board(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

/** The square a capture removes a piece from (differs from `to` for en passant). */
export function captureSquare(m: Pick<Move, 'from' | 'to'> & { isEnPassant?: () => boolean; flags?: string }): Square {
  const ep = typeof m.isEnPassant === 'function' ? m.isEnPassant() : !!m.flags?.includes('e');
  return ep ? (`${m.to[0]}${m.from[1]}` as Square) : m.to;
}

/** Pieces on the board, rank 8 to rank 1, file a to h. */
export function boardPieces(chess: Chess): BoardPiece[] {
  return chess.board().flat().filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ square: p.square, type: p.type, color: p.color }));
}

/** Legal captures of `piece` by the other side, plus a king that attacks it but may not legally take. */
function directAttacksUncached(fen: string, piece: BoardPiece): PieceMove[] {
  const attacker = opposite(piece.color);
  const b = board(withTurn(fen, attacker));
  if (!b) return [];
  const out = b
    .moves({ verbose: true })
    .filter((m) => captureSquare(m) === piece.square)
    .map(toPieceMove);
  if (!out.some((m) => m.piece === 'k')) {
    const kingSq = b.attackers(piece.square).find((sq) => b.get(sq)?.type === 'k');
    if (kingSq) out.push({ piece: 'k', color: attacker, from: kingSq, to: piece.square });
  }
  return out;
}

const directAttacksCached = memo(directAttacksUncached, (fen, piece) => `${fen}|${pieceKey(piece)}`);
const directAttacks = (fen: string, piece: BoardPiece): PieceMove[] => directAttacksCached(fen, piece).slice();

/**
 * Attacking moves on `piece`. With `transitive`, pieces lined up behind an attacker (batteries, x-rays)
 * count too: each attacker is lifted off the board in turn to reveal the next.
 */
function attackingMovesUncached(fen: string, piece: BoardPiece, transitive: boolean): PieceMove[] {
  const found = directAttacks(fen, piece);
  if (!transitive) return found;
  const frontier = found.map((m) => ({ fen, square: m.from, type: m.piece }));
  while (frontier.length) {
    const front = frontier.pop()!;
    if (front.type === 'k') continue; // a king never leads a battery
    const before = directAttacks(front.fen, piece).filter((m) => m.from !== front.square);
    const lifted = board(front.fen);
    if (!lifted) continue;
    lifted.remove(front.square);
    const liftedFen = lifted.fen();
    const after = directAttacks(liftedFen, piece);
    // Symmetric difference, unique by move.
    const beforeKeys = new Set(before.map(moveKey));
    const afterKeys = new Set(after.map(moveKey));
    const seen = new Set<string>();
    const revealed: PieceMove[] = [];
    for (const m of [...before.filter((m) => !afterKeys.has(moveKey(m))), ...after.filter((m) => !beforeKeys.has(moveKey(m)))]) {
      const k = moveKey(m);
      if (seen.has(k)) continue;
      seen.add(k);
      revealed.push(m);
    }
    found.push(...revealed);
    frontier.push(...revealed.map((m) => ({ fen: liftedFen, square: m.from, type: m.piece })));
  }
  return found;
}

const attackingMovesCached = memo(attackingMovesUncached, (fen, piece, transitive) => `${fen}|${pieceKey(piece)}|${transitive}`);
export function attackingMoves(fen: string, piece: BoardPiece, transitive = true): PieceMove[] {
  return attackingMovesCached(fen, piece, transitive).slice();
}

/**
 * Defending moves of `piece`: simulate each capture of it and keep the smallest set of recaptures. A piece
 * nobody attacks is defended by whatever of its own side attacks its square.
 */
function defendingMovesUncached(fen: string, piece: BoardPiece, transitive: boolean): PieceMove[] {
  const attacks = directAttacks(fen, piece);
  let smallest: PieceMove[] | null = null;
  for (const attack of attacks) {
    const b = board(withTurn(fen, opposite(piece.color)));
    if (!b) continue;
    try {
      b.move({ from: attack.from, to: attack.to, promotion: attack.promotion });
    } catch {
      continue;
    }
    const recaptures = attackingMoves(b.fen(), { type: attack.piece, color: attack.color, square: attack.to }, transitive);
    if (!smallest || recaptures.length < smallest.length) smallest = recaptures;
  }
  if (smallest) return smallest;
  const b = board(fen);
  if (!b) return [];
  const flipped: BoardPiece = { ...piece, color: opposite(piece.color) };
  b.put({ type: flipped.type, color: flipped.color }, piece.square);
  return attackingMoves(b.fen(), flipped, transitive);
}

const defendingMovesCached = memo(defendingMovesUncached, (fen, piece, transitive) => `${fen}|${pieceKey(piece)}|${transitive}`);
export function defendingMoves(fen: string, piece: BoardPiece, transitive = true): PieceMove[] {
  return defendingMovesCached(fen, piece, transitive).slice();
}

/** Whether `piece` cannot be won by the opponent. `played` is the move that just put it there, if any. */
function isPieceSafeUncached(fen: string, piece: BoardPiece, captured: PieceSymbol | undefined): boolean {
  const played = captured ? { captured } : undefined;
  const direct = attackingMoves(fen, piece, false).map(attackerPiece);
  const attackers = attackingMoves(fen, piece).map(attackerPiece);
  const defenders = defendingMoves(fen, piece).map(attackerPiece);
  const value = PIECE_VALUE[piece.type];

  // A rook given for a minor piece, recaptured by a minor and defended: an even-ish exchange, not a loss.
  if (
    played?.captured &&
    piece.type === 'r' &&
    PIECE_VALUE[played.captured] === PIECE_VALUE.n &&
    attackers.length === 1 &&
    defenders.length > 0 &&
    PIECE_VALUE[attackers[0].type] === PIECE_VALUE.n
  ) return true;

  if (direct.some((a) => PIECE_VALUE[a.type] < value)) return false;
  if (attackers.length <= defenders.length) return true;

  let cheapest: BoardPiece | null = null;
  for (const a of direct) if (!cheapest || PIECE_VALUE[a.type] < PIECE_VALUE[cheapest.type]) cheapest = a;
  if (!cheapest) return true;
  const cheapestValue = PIECE_VALUE[cheapest.type];
  if (value < cheapestValue && defenders.some((d) => PIECE_VALUE[d.type] < cheapestValue)) return true;
  if (defenders.some((d) => d.type === 'p')) return true;
  return false;
}

const isPieceSafeCached = memo(isPieceSafeUncached, (fen, piece, captured) => `${fen}|${pieceKey(piece)}|${captured ?? ''}`);
export function isPieceSafe(fen: string, piece: BoardPiece, played?: Pick<Move, 'captured'>): boolean {
  return isPieceSafeCached(fen, piece, played?.captured);
}

/** `color`'s pieces (no pawns or king) worth more than what `played` captured that are not safe. */
export function unsafePieces(fen: string, color: Color, played?: Pick<Move, 'captured'>): BoardPiece[] {
  const b = board(fen);
  if (!b) return [];
  const taken = played?.captured ? PIECE_VALUE[played.captured] : 0;
  return boardPieces(b).filter(
    (p) => p.color === color && p.type !== 'p' && p.type !== 'k' && PIECE_VALUE[p.type] > taken && !isPieceSafe(fen, p, played),
  );
}

/** Direct attacks on `color`'s unsafe pieces worth at least the threatened piece (other than itself). */
function counterThreats(fen: string, threatened: BoardPiece, color: Color, played?: Pick<Move, 'captured'>): PieceMove[] {
  return unsafePieces(fen, color, played)
    .filter((p) => p.square !== threatened.square && PIECE_VALUE[p.type] >= PIECE_VALUE[threatened.type])
    .flatMap((p) => attackingMoves(fen, p, false));
}

function mateInOneAvailable(b: Chess): boolean {
  return b.moves().some((san) => san.includes('#'));
}

function replay(fen: string, m: PieceMove | Move): { b: Chess; move: Move } | null {
  const b = board(fen);
  if (!b) return null;
  try {
    const move = b.move({ from: m.from, to: m.to, promotion: m.promotion });
    return { b, move };
  } catch {
    return null;
  }
}

/** Playing `acting` creates a new counter-threat at least as big as the threat on `threatened`. */
export function moveCreatesGreaterThreat(fen: string, threatened: BoardPiece, acting: PieceMove | Move): boolean {
  const before = new Set(counterThreats(fen, threatened, acting.color).map(moveKey));
  const r = replay(fen, acting);
  if (!r) return false;
  const after = counterThreats(r.b.fen(), threatened, acting.color, r.move);
  if (after.some((m) => !before.has(moveKey(m)))) return true;
  return PIECE_VALUE[threatened.type] < PIECE_VALUE.q && mateInOneAvailable(r.b);
}

/** After `acting`, some counter-threat at least as big as the threat on `threatened` exists. */
export function moveLeavesGreaterThreat(fen: string, threatened: BoardPiece, acting: PieceMove | Move): boolean {
  const r = replay(fen, acting);
  if (!r) return false;
  if (counterThreats(r.b.fen(), threatened, acting.color).length > 0) return true;
  return PIECE_VALUE[threatened.type] < PIECE_VALUE.q && mateInOneAvailable(r.b);
}

/** Every one of `actingMoves` runs into a counter-threat (true for an empty list). */
export function hasDangerLevels(
  fen: string,
  threatened: BoardPiece,
  actingMoves: (PieceMove | Move)[],
  strategy: 'creates' | 'leaves' = 'leaves',
): boolean {
  return actingMoves.every((m) =>
    strategy === 'creates' ? moveCreatesGreaterThreat(fen, threatened, m) : moveLeavesGreaterThreat(fen, threatened, m),
  );
}

/** Unsafe where it stands and on every square it can go to (or moving it hands over a bigger threat). */
export function isPieceTrapped(fen: string, piece: BoardPiece, dangerLevels = true): boolean {
  const calibrated = withTurn(fen, piece.color);
  const b = board(calibrated);
  if (!b) return false;
  const standingSafe = isPieceSafe(calibrated, piece);
  const escapes = b.moves({ square: piece.square, verbose: true });
  const allUnsafe = escapes.every((m) => {
    if (m.captured === 'k') return false;
    if (dangerLevels && moveCreatesGreaterThreat(calibrated, piece, m)) return true;
    const r = replay(calibrated, m);
    if (!r) return false;
    return !isPieceSafe(r.b.fen(), { ...piece, square: r.move.to }, r.move);
  });
  return !standingSafe && allUnsafe;
}

/* ---------- Material (phase detection) ---------- */

const MATERIAL: Record<PieceSymbol, number> = { p: 0, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Non-pawn, non-king material of both sides together (N/B 3, R 5, Q 9). */
export function pieceMaterial(fen: string): number {
  let total = 0;
  for (const ch of fen.split(' ')[0]) {
    const t = ch.toLowerCase() as PieceSymbol;
    if (t in MATERIAL) total += MATERIAL[t];
  }
  return total;
}
