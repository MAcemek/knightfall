import { describe, expect, it } from 'vitest';
import { cooldownPassed, incomingReaction, pruneReactions, REACTION_TTL_MS, type ReactionItem } from './reactions.ts';

const item = (id: number, at: number): ReactionItem => ({ id, reaction: 'gg', from: 'Ana', at });

describe('cooldownPassed', () => {
  it('allows the first send and sends after the cooldown', () => {
    expect(cooldownPassed(1000, null)).toBe(true);
    expect(cooldownPassed(1000, 0, 1500)).toBe(false);
    expect(cooldownPassed(1500, 0, 1500)).toBe(true);
  });
});

describe('pruneReactions', () => {
  it('drops expired ones and keeps the array when nothing expired', () => {
    const list = [item(1, 0), item(2, 3000)];
    expect(pruneReactions(list, 1000)).toBe(list);
    expect(pruneReactions(list, REACTION_TTL_MS + 100).map((r) => r.id)).toEqual([2]);
  });
});

describe('incomingReaction', () => {
  it('accepts a valid reaction and ignores unknown ones', () => {
    expect(incomingReaction({ type: 'reaction', reaction: 'clap', from: 'Ana' })).toEqual({ reaction: 'clap', from: 'Ana' });
    expect(incomingReaction({ type: 'reaction', reaction: 'nope', from: 'Ana' })).toBeNull();
    expect(incomingReaction({ type: 'pong' })).toBeNull();
  });
  it('falls back for a missing name', () => {
    expect(incomingReaction({ type: 'reaction', reaction: 'fire' })?.from).toBe('Opponent');
  });
});
