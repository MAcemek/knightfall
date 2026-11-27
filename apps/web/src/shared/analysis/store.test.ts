import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOpenings } from './store.ts';

describe('loadOpenings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not cache a failed fetch', async () => {
    const table = { a: 1 };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => table });
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadOpenings()).toBeNull();
    expect(await loadOpenings()).toBeNull();
    expect(await loadOpenings()).toBe(table);
    expect(await loadOpenings()).toBe(table);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
