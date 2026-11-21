import { describe, expect, it } from 'vitest';
import { beginTimedPlay, isTimedPlayActive } from './timedPlay.ts';

describe('timed play signal', () => {
  it('is active between begin and release', () => {
    expect(isTimedPlayActive()).toBe(false);
    const release = beginTimedPlay();
    expect(isTimedPlayActive()).toBe(true);
    release();
    expect(isTimedPlayActive()).toBe(false);
  });

  it('overlapping holders keep it active, and a double release does not underflow', () => {
    const a = beginTimedPlay();
    const b = beginTimedPlay();
    a();
    a();
    expect(isTimedPlayActive()).toBe(true);
    b();
    expect(isTimedPlayActive()).toBe(false);
    const c = beginTimedPlay();
    expect(isTimedPlayActive()).toBe(true);
    c();
  });
});
