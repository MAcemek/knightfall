/** Friend codes for Puzzle Battle challenges: 6 characters, no look-alikes (0/O/1/I/L). */

export const BATTLE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const BATTLE_CODE_LENGTH = 6;

/** Uppercase and strip everything that is not a letter or digit (spaces, dashes). */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidCode(code: string): boolean {
  if (code.length !== BATTLE_CODE_LENGTH) return false;
  for (const ch of code) if (!BATTLE_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** `7QXK4M` -> `7QX-K4M`. Partial input is grouped too, for live formatting. */
export function formatCode(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}
