import { describe, expect, it } from 'vitest';
import { BATTLE_CODE_ALPHABET, formatCode, isValidCode, normalizeCode } from './battleCode.ts';

describe('battle codes', () => {
  it('has no look-alike characters', () => {
    for (const ch of '0O1IL') expect(BATTLE_CODE_ALPHABET.includes(ch)).toBe(false);
    expect(BATTLE_CODE_ALPHABET).toHaveLength(31);
  });
  it('normalizes case, spaces and dashes', () => {
    expect(normalizeCode(' 7qx-k4m ')).toBe('7QXK4M');
    expect(normalizeCode('7QX K4M')).toBe('7QXK4M');
  });
  it('validates length and alphabet', () => {
    expect(isValidCode('7QXK4M')).toBe(true);
    expect(isValidCode('7QXK4')).toBe(false);
    expect(isValidCode('7QXK4MM')).toBe(false);
    expect(isValidCode('7QXK40')).toBe(false);
    expect(isValidCode('7qxk4m')).toBe(false);
    expect(isValidCode('')).toBe(false);
  });
  it('formats as XXX-XXX', () => {
    expect(formatCode('7QXK4M')).toBe('7QX-K4M');
    expect(formatCode('7QX')).toBe('7QX');
    expect(formatCode('7QXK')).toBe('7QX-K');
  });
});
