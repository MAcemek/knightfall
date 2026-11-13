import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import {
  attackingMoves, boardPieces, captureSquare, defendingMoves, hasDangerLevels, isPieceSafe, isPieceTrapped, PIECE_VALUE,
  pieceMaterial, unsafePieces, withTurn, type BoardPiece,
} from './pieceSafety.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const piece = (square: string, type: string, color: string) => ({ square, type, color }) as BoardPiece;

describe('withTurn / pieceMaterial / board helpers', () => {
  it('flips the side to move and clears en passant only when the turn changes', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
    expect(withTurn(fen, 'b')).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2');
    expect(withTurn(fen, 'w')).toBe(fen);
  });
  it('counts non-pawn, non-king material of both sides', () => {
    expect(pieceMaterial(START)).toBe(62);
    expect(pieceMaterial('4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1')).toBe(0);
    expect(pieceMaterial('r3k3/8/8/8/8/8/8/3QK1N1 w - - 0 1')).toBe(5 + 9 + 3);
  });
  it('lists the pieces and finds the capture square (en passant included)', () => {
    expect(boardPieces(new Chess())).toHaveLength(32);
    expect(PIECE_VALUE).toMatchObject({ p: 1, n: 3, b: 3, r: 5, q: 9, k: Infinity });
    const c = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const ep = c.moves({ verbose: true }).find((m) => m.to === 'd6')!;
    expect(captureSquare(ep)).toBe('d5');
    const plain = new Chess('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1').moves({ verbose: true }).find((m) => m.captured)!;
    expect(captureSquare(plain)).toBe('d5');
  });
});

describe('attackingMoves', () => {
  const doubled = '4k3/8/8/p7/8/8/R7/R3K3 w - - 0 1';
  const pawn = piece('a5', 'p', 'b');
  it('finds the direct attacker only without transitive', () => {
    expect(attackingMoves(doubled, pawn, false)).toEqual([{ piece: 'r', color: 'w', from: 'a2', to: 'a5', promotion: undefined }]);
  });
  it('sees the rook behind it (a battery) with transitive', () => {
    const all = attackingMoves(doubled, pawn);
    expect(all.map((m) => m.from).sort()).toEqual(['a1', 'a2']);
  });
  it('counts a king that attacks the piece, and nothing for an unattacked piece', () => {
    const k = attackingMoves('8/8/8/3p4/4K3/8/8/k7 w - - 0 1', piece('d5', 'p', 'b'));
    expect(k.map((m) => m.piece)).toEqual(['k']);
    expect(attackingMoves(START, piece('e2', 'p', 'w'))).toEqual([]);
  });
});

describe('defendingMoves', () => {
  it('returns the recaptures after the capture', () => {
    const d = defendingMoves('4k3/8/1p6/p7/8/8/R7/R3K3 w - - 0 1', piece('a5', 'p', 'b'));
    expect(d.map((m) => `${m.piece}${m.from}`)).toEqual(['pb6']);
  });
  it('is empty for an undefended piece and counts a rook defender', () => {
    expect(defendingMoves('4k3/8/8/p7/8/8/R7/4K3 w - - 0 1', piece('a5', 'p', 'b'))).toEqual([]);
    expect(defendingMoves('r3k3/8/8/p7/8/8/R7/4K3 w - - 0 1', piece('a5', 'p', 'b')).map((m) => m.from)).toEqual(['a8']);
  });
  it("for an unattacked piece counts its own side's pieces covering the square", () => {
    const d = defendingMoves('4k3/8/8/8/8/8/3P4/3RK3 w - - 0 1', piece('d2', 'p', 'w'));
    expect(d.map((m) => m.from).sort()).toEqual(['d1', 'e1']);
  });
});

describe('isPieceSafe rules', () => {
  it('rule 1: a rook that just took a knight, attacked once by a minor and defended, is safe', () => {
    const fen = '4k3/8/4b3/3R4/4P3/8/8/4K3 w - - 0 1';
    const rook = piece('d5', 'r', 'w');
    expect(isPieceSafe(fen, rook, { captured: 'n' })).toBe(true);
    // Not a knight capture, or no capture at all: the bishop is a cheaper attacker (rule 2).
    expect(isPieceSafe(fen, rook, { captured: 'p' })).toBe(false);
    expect(isPieceSafe(fen, rook)).toBe(false);
  });
  it('rule 2: any cheaper direct attacker makes it unsafe, however well defended', () => {
    expect(isPieceSafe('4k3/8/8/3p4/4N3/4P3/8/3RK3 b - - 0 1', piece('e4', 'n', 'w'))).toBe(false);
  });
  it('rule 3: attackers <= defenders is safe (also when nothing attacks it)', () => {
    expect(isPieceSafe('3rk3/8/8/3r4/8/8/3R4/4K3 w - - 0 1', piece('d5', 'r', 'b'))).toBe(true);
    expect(isPieceSafe(START, piece('b1', 'n', 'w'))).toBe(true);
  });
  it('rule 4: cheaper than the cheapest direct attacker and defended by something cheaper than it', () => {
    // Knight d5 hit by a rook battery (2 attackers), defended once by a pawn.
    const fen = '4k3/8/4p3/3n4/8/8/3R4/3RK3 w - - 0 1';
    expect(attackingMoves(fen, piece('d5', 'n', 'b'))).toHaveLength(2);
    expect(defendingMoves(fen, piece('d5', 'n', 'b'))).toHaveLength(1);
    expect(isPieceSafe(fen, piece('d5', 'n', 'b'))).toBe(true);
    // A queen defender is not cheaper than the rook attacker.
    expect(isPieceSafe('3qk3/8/8/3n4/8/8/3R4/3RK3 w - - 0 1', piece('d5', 'n', 'b'))).toBe(false);
  });
  it('rule 5: any pawn defender is safe', () => {
    // Bishop d5 attacked by two knights (equal value), defended by a pawn.
    expect(isPieceSafe('4k3/8/4p3/3b4/5N2/2N5/8/4K3 w - - 0 1', piece('d5', 'b', 'b'))).toBe(true);
  });
  it('rule 6: otherwise unsafe', () => {
    // Same, but the defender is a rook: 2 attackers > 1 defender, no pawn, not cheaper than a knight.
    expect(isPieceSafe('3rk3/8/8/3b4/5N2/2N5/8/4K3 w - - 0 1', piece('d5', 'b', 'b'))).toBe(false);
    expect(isPieceSafe('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', piece('d5', 'n', 'b'))).toBe(false);
  });
});

describe('unsafePieces and threats', () => {
  it('lists unsafe non-pawn pieces worth more than what was just captured', () => {
    const fen = '4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1';
    expect(unsafePieces(fen, 'w')).toEqual([piece('e4', 'n', 'w')]);
    expect(unsafePieces(fen, 'w', { captured: 'n' })).toEqual([]);
    expect(unsafePieces(fen, 'b')).toEqual([]);
  });
  it('hasDangerLevels is true for an empty list and checks every acting move', () => {
    const fen = '4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1';
    expect(hasDangerLevels(fen, piece('e4', 'n', 'w'), [])).toBe(true);
    const direct = attackingMoves(fen, piece('e4', 'n', 'w'), false);
    expect(hasDangerLevels(fen, piece('e4', 'n', 'w'), direct)).toBe(false);
  });
});

describe('isPieceTrapped', () => {
  it('a bishop on a7 attacked by a rook, with b8 covered and b6 guarded by a pawn, is trapped', () => {
    const fen = 'r3k3/B1p5/1p6/8/8/8/8/4K3 w - - 0 1';
    expect(isPieceTrapped(fen, piece('a7', 'b', 'w'))).toBe(true);
  });
  it('is not trapped when a safe square exists, or when the piece is safe where it stands', () => {
    expect(isPieceTrapped('r3k3/B1p5/8/8/8/8/8/4K3 w - - 0 1', piece('a7', 'b', 'w'))).toBe(false);
    expect(isPieceTrapped(START, piece('c1', 'b', 'w'))).toBe(false);
  });
});
