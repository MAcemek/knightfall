import { describe, expect, it } from 'vitest';
import { boardInteractive, isSteppable, maxView, returnsToLive, stepAbility, stepTarget } from './stepLogic.ts';

describe('isSteppable', () => {
  it('allows stepping only while the solver is to move or once the puzzle is over', () => {
    expect(isSteppable('player')).toBe(true);
    expect(isSteppable('solved')).toBe(true);
    expect(isSteppable('solution')).toBe(true);
    for (const s of ['idle', 'intro', 'opponent', 'failed'] as const) expect(isSteppable(s)).toBe(false);
  });
});

describe('stepAbility in progress', () => {
  it('lets Back reach the position before the opponent setup move (live ply 1)', () => {
    expect(stepAbility('player', null, 1, 4)).toEqual({ steppable: true, canBack: true, canForward: false });
    expect(stepAbility('player', 0, 1, 4)).toEqual({ steppable: true, canBack: false, canForward: true });
  });
  it('has no history for a puzzle without a setup move at the start', () => {
    expect(stepAbility('player', null, 0, 4)).toEqual({ steppable: true, canBack: false, canForward: false });
  });
  it('allows going back through earlier plies later in the line, never past live', () => {
    expect(stepAbility('player', null, 3, 6)).toMatchObject({ canBack: true, canForward: false });
    expect(stepAbility('player', 1, 3, 6)).toMatchObject({ canBack: true, canForward: true });
    expect(stepAbility('player', 3, 3, 6)).toMatchObject({ canBack: true, canForward: false });
  });
  it('is not steppable during intro, the opponent reply or the failed hold', () => {
    expect(stepAbility('intro', null, 0, 4).steppable).toBe(false);
    expect(stepAbility('opponent', null, 2, 4)).toEqual({ steppable: false, canBack: false, canForward: false });
    expect(stepAbility('failed', null, 1, 4).canBack).toBe(false);
  });
});

describe('stepAbility after the puzzle', () => {
  it('solved: Back from the end, no Forward until stepped back', () => {
    expect(stepAbility('solved', null, 4, 4)).toMatchObject({ canBack: true, canForward: false });
    expect(stepAbility('solved', 2, 4, 4)).toMatchObject({ canBack: true, canForward: true });
    expect(stepAbility('solved', 0, 4, 4)).toMatchObject({ canBack: false, canForward: true });
  });
  it('solution playback: forward reaches the full line even though live is behind', () => {
    expect(maxView('solution', 2, 4)).toBe(4);
    expect(stepAbility('solution', null, 2, 4)).toMatchObject({ canBack: true, canForward: true });
  });
});

describe('stepTarget', () => {
  it('moves one ply and refuses out-of-range steps', () => {
    expect(stepTarget('player', null, 1, 4, -1)).toBe(0);
    expect(stepTarget('player', 0, 1, 4, 1)).toBe(1);
    expect(stepTarget('player', 0, 1, 4, -1)).toBeNull();
    expect(stepTarget('player', null, 1, 4, 1)).toBeNull();
    expect(stepTarget('opponent', null, 1, 4, -1)).toBeNull();
    expect(stepTarget('solved', null, 4, 4, -1)).toBe(3);
  });
});

describe('returnsToLive / boardInteractive', () => {
  it('ends the view at the live ply only while in progress', () => {
    expect(returnsToLive('player', 1, 1)).toBe(true);
    expect(returnsToLive('player', 0, 1)).toBe(false);
    expect(returnsToLive('solved', 4, 4)).toBe(false);
  });
  it('is not interactive while viewing an earlier position', () => {
    expect(boardInteractive('player', false)).toBe(true);
    expect(boardInteractive('player', true)).toBe(false);
    expect(boardInteractive('opponent', false)).toBe(false);
  });
});
