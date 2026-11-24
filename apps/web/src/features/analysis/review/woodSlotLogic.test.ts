import { describe, expect, it } from 'vitest';
import { gamePuzzleId, woodSlotState } from './woodSlotLogic.ts';

const base = {
  gameKey: 'li-abc',
  move: { ply: 6, color: 'w' as const, class: 'blunder' as const },
  classified: true,
  side: 'w' as const,
  puzzleIds: new Set(['game-li-abc-6']),
  picks: [] as string[],
};

describe('woodSlotState', () => {
  it('builds the id like the practice puzzles', () => {
    expect(gamePuzzleId('li-abc', 6)).toBe('game-li-abc-6');
  });
  it('offers the add button for an own blunder, mistake or miss with a puzzle', () => {
    expect(woodSlotState(base)).toEqual({ kind: 'add', puzzleId: 'game-li-abc-6' });
    for (const cls of ['mistake', 'miss'] as const) {
      expect(woodSlotState({ ...base, move: { ...base.move, class: cls } }).kind).toBe('add');
    }
  });
  it('says so when it is already picked', () => {
    expect(woodSlotState({ ...base, picks: ['x', 'game-li-abc-6'] })).toEqual({ kind: 'in-set' });
  });
  it('stays hidden otherwise', () => {
    expect(woodSlotState({ ...base, move: null }).kind).toBe('hidden');
    expect(woodSlotState({ ...base, classified: false }).kind).toBe('hidden');
    expect(woodSlotState({ ...base, side: null }).kind).toBe('hidden');
    expect(woodSlotState({ ...base, move: { ...base.move, color: 'b' } }).kind).toBe('hidden');
    expect(woodSlotState({ ...base, move: { ...base.move, class: 'inaccuracy' } }).kind).toBe('hidden');
    expect(woodSlotState({ ...base, move: { ...base.move, class: 'best' } }).kind).toBe('hidden');
    expect(woodSlotState({ ...base, puzzleIds: new Set() }).kind).toBe('hidden');
  });
});
