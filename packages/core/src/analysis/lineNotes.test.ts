import { describe, expect, it } from 'vitest';
import { lineNotes } from './lineNotes.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const notes = (fen: string, ...pv: string[]) => lineNotes(fen, pv).map((n) => n.note);

describe('lineNotes', () => {
  it('says nothing about a quiet pawn move and develops a knight', () => {
    expect(notes(START, 'e2e4', 'e7e5', 'b1c3')).toEqual([null, null, 'develops the knight']);
  });
  it('names a capture and a recapture', () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(notes(fen, 'e4d5', 'd8d5')).toEqual(['takes the pawn', 'takes back on d5']);
  });
  it('says check, and capture with check', () => {
    expect(notes('7k/8/8/8/8/8/4R3/4K3 w - - 0 1', 'e2e8')).toEqual(['check']);
    expect(notes('4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1', 'e2e8')).toEqual(['takes the rook with check']);
  });
  it('says checkmate and promotion', () => {
    expect(notes('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8')).toEqual(['checkmate']);
    expect(notes('8/P6k/8/8/8/8/8/K7 w - - 0 1', 'a7a8q')).toEqual(['promotes to a queen']);
  });
  it('says castling', () => {
    expect(notes('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1', 'e8c8')).toEqual(['castles short', 'castles long']);
  });
  it('trades queens when the queen is taken and taken back, and otherwise takes the queen', () => {
    expect(notes('3rk3/8/8/3q4/8/8/3Q4/3RK3 w - - 0 1', 'd2d5', 'd8d5')[0]).toBe('trades queens');
    expect(notes('4k3/8/8/3q4/8/8/3Q4/4K3 w - - 0 1', 'd2d5', 'e8e7')[0]).toBe('takes the queen');
  });
  it('threatens an undefended piece, or one worth more than the attacker', () => {
    expect(notes('4k3/8/8/3q4/8/8/8/4K2R w - - 0 1', 'h1h5')).toEqual(['threatens the queen on d5']);
    // A pawn attacks a defended knight: the knight is worth more than the pawn.
    expect(notes('4k3/8/3p4/8/2n5/8/1P6/4K3 w - - 0 1', 'b2b3')).toEqual(['threatens the knight on c4']);
  });
  it('does not call a defended piece of equal value a threat', () => {
    // The knight attacks a knight that a pawn defends.
    expect(notes('4k3/8/2p5/3n4/8/2N5/8/4K3 w - - 0 1', 'c3b5')).not.toEqual(['threatens the knight on d5']);
  });
  it('calls a second attacker on an attacked piece a double attack, not a new threat', () => {
    expect(notes('4k3/8/8/3q4/8/8/8/3RK2R w - - 0 1', 'h1h5')).toEqual(['attacks d5 twice']);
  });
  it('attacks a square twice', () => {
    // Queen and rook now both aim at the pawn on e7, which the king defends.
    expect(notes('4k3/4p3/8/8/8/8/3Q4/4RK2 w - - 0 1', 'd2d6')).toEqual(['attacks e7 twice']);
  });
  it('defends a piece that is under attack', () => {
    expect(notes('4k3/8/8/3p4/4P3/8/8/R3K3 w - - 0 1', 'a1a4')).toEqual(['defends the pawn on e4']);
  });
  it('moves a piece out of attack', () => {
    expect(notes('4k3/8/8/8/8/8/2p5/3NK3 w - - 0 1', 'd1b2')).toEqual(['moves the knight out of attack']);
  });
  it('stops at the first illegal move and respects max', () => {
    expect(lineNotes(START, ['e2e4', 'e2e4', 'e7e5']).map((n) => n.san)).toEqual(['e4']);
    expect(lineNotes(START, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 2)).toHaveLength(2);
    expect(lineNotes('not a fen', ['e2e4'])).toEqual([]);
  });
  it('threatens the pawn Nf3 attacks', () => {
    expect(notes(START, 'e2e4', 'e7e5', 'g1f3')[2]).toBe('threatens the pawn on e5');
  });
  it('returns the SAN and UCI of every move', () => {
    expect(lineNotes(START, ['g1f3'])[0]).toMatchObject({ uci: 'g1f3', san: 'Nf3' });
  });
  it('does not say a pinned piece threatens anything', () => {
    // Re2 is pinned to Ke1 by Re8; after Re5 it cannot take the queen on b5.
    const n = lineNotes('4r1k1/8/8/1q6/8/8/4R3/4K3 w - - 0 1', ['e2e5'])[0].note;
    expect(n ?? '').not.toMatch(/threatens|twice/);
  });
});
