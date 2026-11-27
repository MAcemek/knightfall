import { describe, expect, it } from 'vitest';
import { formatBytes, storageLine, storageState } from './storageLogic.ts';

describe('storageLogic', () => {
  it('decides the state', () => {
    expect(storageState(true)).toBe('persisted');
    expect(storageState(false)).toBe('best-effort');
  });
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });
  it('builds the line with and without an estimate', () => {
    expect(storageLine(true)).toBe('Storage: kept by the browser.');
    expect(storageLine(false)).toContain('may clear it when space runs low');
    expect(storageLine(true, 2 * 1024 * 1024, 1024 ** 3)).toBe('Storage: kept by the browser. 2 MB used of 1 GB available.');
    expect(storageLine(true, 5, 0)).toBe('Storage: kept by the browser.');
  });
});
