import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { TbCategory } from '../../shared/tablebase.ts';
import { ENDGAME_GROUPS, ENDGAMES, findEndgame } from './positions.ts';

/**
 * What tablebase.lichess.ovh/standard answered for each position (category for the side to move, which is the
 * trainee). Checked once by hand against the live API; kept here so the tests never use the network.
 */
const VERIFIED: Record<string, TbCategory> = {
  kqk: 'win',
  krk: 'win',
  kbbk: 'win',
  kbnk: 'win',
  'key-squares': 'win',
  opposition: 'win',
  'outside-passer': 'win',
  'rook-pawn': 'draw',
  'wrong-bishop': 'draw',
  blockade: 'draw',
  lucena: 'win',
  philidor: 'draw',
  vancura: 'draw',
  'rook-v-pawn': 'win',
  'rook-v-bishop': 'draw',
  'queen-v-pawn-win': 'win',
  'queen-v-pawn-draw': 'draw',
  'queen-v-rook': 'win',
  'queen-v-rook-hard': 'win',
};

const pieceCount = (fen: string) => fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;

describe('curated endgames', () => {
  it('has a verified answer for every position and no extras', () => {
    expect(ENDGAMES.map((p) => p.id).sort()).toEqual(Object.keys(VERIFIED).sort());
    expect(new Set(ENDGAMES.map((p) => p.id)).size).toBe(ENDGAMES.length);
  });

  it('every position is legal, at most 7 pieces, and has the trainee to move', () => {
    for (const p of ENDGAMES) {
      expect(() => new Chess(p.fen), p.id).not.toThrow();
      expect(pieceCount(p.fen), p.id).toBeLessThanOrEqual(7);
      expect(p.fen.split(' ')[1], p.id).toBe(p.side);
      expect(new Chess(p.fen).isGameOver(), p.id).toBe(false);
    }
  });

  it('the tablebase category matches the goal', () => {
    for (const p of ENDGAMES) {
      expect(VERIFIED[p.id], p.id).toBe(p.goal);
    }
  });

  it('draws say how long to hold, wins do not', () => {
    for (const p of ENDGAMES) {
      if (p.goal === 'draw') expect(p.holdMoves, p.id).toBeGreaterThan(0);
      else expect(p.holdMoves, p.id).toBeUndefined();
    }
  });

  it('every group is used and every position belongs to a known group', () => {
    const groups = new Set(ENDGAME_GROUPS.map((g) => g.id));
    for (const p of ENDGAMES) expect(groups.has(p.group), p.id).toBe(true);
    for (const g of ENDGAME_GROUPS) expect(ENDGAMES.some((p) => p.group === g.id), g.id).toBe(true);
  });

  it('has about twenty positions with both goals and both sides', () => {
    expect(ENDGAMES.length).toBeGreaterThanOrEqual(18);
    expect(new Set(ENDGAMES.map((p) => p.goal))).toEqual(new Set(['win', 'draw']));
    expect(new Set(ENDGAMES.map((p) => p.side))).toEqual(new Set(['w', 'b']));
  });

  it('finds a position by id', () => {
    expect(findEndgame('lucena')?.title).toBe('Lucena position');
    expect(findEndgame('nope')).toBeUndefined();
    expect(findEndgame(undefined)).toBeUndefined();
  });
});
