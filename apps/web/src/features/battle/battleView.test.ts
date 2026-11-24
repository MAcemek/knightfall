import { describe, expect, it } from 'vitest';
import { battleViewKey } from './battleView.ts';
import { initialBattleState, type BattleState, type MatchInfo } from './battleState.ts';

const match = (roomId: string): MatchInfo => ({
  roomId,
  seed: 1,
  me: { name: 'Ana', rating: 1500 },
  opponent: { name: 'Ben', rating: 1500 },
  startsAt: 0,
  endsAt: 0,
});
const st = (patch: Partial<BattleState>): BattleState => ({ ...initialBattleState, ...patch });
const end = { result: 'win', reason: 'time', you: { solved: 1, strikes: 0 }, opponent: { solved: 0, strikes: 0 }, ratingBefore: 1500, ratingAfter: 1510, endedAt: 0 } as const;

describe('battleViewKey', () => {
  it('keeps lobby, connecting and searching on one key', () => {
    for (const phase of ['lobby', 'connecting', 'searching'] as const) expect(battleViewKey(st({ phase }), null)).toBe('lobby');
  });

  it('gives the intro and the game of a match the same key, per room', () => {
    expect(battleViewKey(st({ phase: 'matched', match: match('r1') }), null)).toBe('game:r1');
    expect(battleViewKey(st({ phase: 'playing', match: match('r1') }), null)).toBe('game:r1');
    expect(battleViewKey(st({ phase: 'playing', match: match('r2') }), null)).toBe('game:r2');
  });

  it('gives the end screen its own key, and falls back to the lobby without end info', () => {
    expect(battleViewKey(st({ phase: 'ended', match: match('r1'), end: { ...end } }), null)).toBe('end:r1');
    expect(battleViewKey(st({ phase: 'ended', match: match('r1'), end: null }), null)).toBe('lobby');
  });

  it('maps club phases; countdown and playing are one race', () => {
    const s = st({});
    expect(battleViewKey(s, { phase: 'lobby' })).toBe('club-lobby');
    expect(battleViewKey(s, { phase: 'countdown' })).toBe('club-race');
    expect(battleViewKey(s, { phase: 'playing' })).toBe('club-race');
    expect(battleViewKey(s, { phase: 'ended' })).toBe('club-end');
  });

  it('lets a club room win over a stale match', () => {
    expect(battleViewKey(st({ phase: 'playing', match: match('r1') }), { phase: 'lobby' })).toBe('club-lobby');
  });
});
