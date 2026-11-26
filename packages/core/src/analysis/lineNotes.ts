import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import { uciToMove } from '../validate.ts';
import { PIECE_VALUE } from './pieceSafety.ts';

/**
 * The idea behind each move of an engine line, in a few words, from facts on the board only: what it takes, whether
 * it gives check, what it newly attacks, what it newly defends. At most one short clause per move, the most
 * important first. Pure.
 */

export interface LineNote {
  uci: string;
  san: string;
  /** One short clause, or null when the move has nothing worth saying. */
  note: string | null;
}

const NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');

interface Placed {
  square: Square;
  type: PieceSymbol;
}

function piecesOf(chess: Chess, color: Color): Placed[] {
  const out: Placed[] = [];
  for (const row of chess.board()) {
    for (const p of row) if (p && p.color === color && p.type !== 'k') out.push({ square: p.square, type: p.type });
  }
  return out;
}

/** Most valuable first; the square name breaks ties so the choice is stable. */
const byValue = (a: Placed, b: Placed) => PIECE_VALUE[b.type] - PIECE_VALUE[a.type] || (a.square < b.square ? -1 : 1);

/**
 * For a position where `color` is not to move: which of its pieces could really capture on a square. chess.js
 * `attackers` ignores pins, so an absolutely pinned piece is left out here.
 */
function capturers(chess: Chess, color: Color): (sq: Square) => Square[] {
  const parts = chess.fen().split(' ');
  parts[1] = color;
  parts[3] = '-';
  let flipped: Chess | null = null;
  try {
    flipped = chess.turn() === color ? chess : new Chess(parts.join(' '));
  } catch {
    flipped = null;
  }
  return (sq) => {
    const from = chess.attackers(sq, color);
    if (!flipped) return from;
    const base = flipped;
    return from.filter((f) => base.moves({ square: f, verbose: true }).some((mv) => mv.to === sq));
  };
}

/** An enemy piece the move newly attacks that is undefended or worth more than its cheapest attacker. */
function newThreat(before: Chess, after: Chess, mover: Color): Placed | null {
  const enemy = opposite(mover);
  const capture = capturers(after, mover);
  const hits = piecesOf(after, enemy)
    .filter((p) => {
      const now = capture(p.square);
      if (now.length === 0 || before.attackers(p.square, mover).length > 0) return false;
      if (after.attackers(p.square, enemy).length === 0) return true;
      const cheapest = Math.min(...now.map((sq) => PIECE_VALUE[after.get(sq)!.type]));
      return PIECE_VALUE[p.type] > cheapest;
    })
    .sort(byValue);
  return hits[0] ?? null;
}

/** An enemy piece or pawn that the moved piece helps to attack a second time. */
function doubleAttack(before: Chess, after: Chess, m: Move): Placed | null {
  const capture = capturers(after, m.color);
  const hits = piecesOf(after, opposite(m.color))
    .filter((p) => {
      const now = capture(p.square);
      return now.length >= 2 && now.includes(m.to) && before.attackers(p.square, m.color).length < 2;
    })
    .sort(byValue);
  return hits[0] ?? null;
}

/** One of the mover's pieces that is attacked and that the moved piece now helps to defend. */
function newDefence(before: Chess, after: Chess, m: Move): Placed | null {
  const enemy = opposite(m.color);
  const hits = piecesOf(after, m.color)
    .filter(
      (p) =>
        p.square !== m.to &&
        after.attackers(p.square, enemy).length > 0 &&
        after.attackers(p.square, m.color).includes(m.to) &&
        !before.attackers(p.square, m.color).includes(m.from),
    )
    .sort(byValue);
  return hits[0] ?? null;
}

function noteFor(before: Chess, after: Chess, m: Move, prev: Move | null, next: Move | null): string | null {
  if (after.isCheckmate()) return 'checkmate';
  if (m.promotion) return `promotes to a ${NAME[m.promotion]}${after.isCheck() ? ' with check' : ''}`;
  if (m.isKingsideCastle()) return 'castles short';
  if (m.isQueensideCastle()) return 'castles long';
  const check = after.isCheck() ? ' with check' : '';
  if (m.captured) {
    if (m.captured === 'q' && next?.captured === 'q' && next.to === m.to) return `trades queens${check}`;
    if (prev?.captured && prev.to === m.to) return `takes back on ${m.to}${check}`;
    return `takes the ${NAME[m.captured]}${check}`;
  }
  if (check) return 'check';
  const threat = newThreat(before, after, m.color);
  if (threat) return `threatens the ${NAME[threat.type]} on ${threat.square}`;
  const twice = doubleAttack(before, after, m);
  if (twice) return `attacks ${twice.square} twice`;
  const defends = newDefence(before, after, m);
  if (defends) return `defends the ${NAME[defends.type]} on ${defends.square}`;
  if (m.piece !== 'k' && m.piece !== 'p' && before.attackers(m.from, opposite(m.color)).length > 0 && after.attackers(m.to, opposite(m.color)).length === 0) {
    return `moves the ${NAME[m.piece]} out of attack`;
  }
  if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === (m.color === 'w' ? '1' : '8')) return `develops the ${NAME[m.piece]}`;
  return null;
}

/** A note per move of `pv` (UCI) played from `fen`. Stops at the first illegal move or after `max` moves. */
export function lineNotes(fen: string, pv: readonly string[], max = 8): LineNote[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const played: { before: Chess; after: Chess; move: Move; uci: string }[] = [];
  for (const uci of pv.slice(0, max)) {
    const before = new Chess(chess.fen());
    let move: Move;
    try {
      move = chess.move(uciToMove(uci));
    } catch {
      break;
    }
    played.push({ before, after: new Chess(chess.fen()), move, uci });
  }
  return played.map((p, i) => ({
    uci: p.uci,
    san: p.move.san,
    note: noteFor(p.before, p.after, p.move, played[i - 1]?.move ?? null, played[i + 1]?.move ?? null),
  }));
}
