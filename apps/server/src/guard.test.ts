import { describe, expect, it, vi } from 'vitest';
import { guard } from './guard.ts';

describe('guard', () => {
  it('passes arguments through', () => {
    const fn = vi.fn();
    guard('x', fn, () => {})(1, 'a');
    expect(fn).toHaveBeenCalledWith(1, 'a');
  });

  it('logs a throwing callback instead of throwing', () => {
    const log = vi.fn();
    const run = guard('room timer', () => {
      throw new Error('boom');
    }, log);
    expect(() => run()).not.toThrow();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain('room timer failed');
    expect(log.mock.calls[0][0]).toContain('boom');
  });
});
