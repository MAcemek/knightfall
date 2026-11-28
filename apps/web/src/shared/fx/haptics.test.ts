import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptic, setHapticsEnabled } from './haptics.ts';

describe('haptic', () => {
  beforeEach(() => setHapticsEnabled(true));
  afterEach(() => vi.unstubAllGlobals());

  it('vibrates with the pattern for each kind', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    haptic('correct');
    haptic('wrong');
    haptic('solved');
    haptic('strike');
    haptic('win');
    expect(vibrate.mock.calls.map((c) => c[0])).toEqual([12, [30, 40, 30], [18, 40, 18], [60], [20, 60, 40]]);
  });

  it('does nothing when disabled', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    setHapticsEnabled(false);
    haptic('correct');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing without navigator or navigator.vibrate', () => {
    vi.stubGlobal('navigator', {});
    expect(() => haptic('wrong')).not.toThrow();
    vi.stubGlobal('navigator', undefined);
    expect(() => haptic('wrong')).not.toThrow();
  });

  it('swallows errors thrown by vibrate', () => {
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('blocked'); } });
    expect(() => haptic('win')).not.toThrow();
  });
});
