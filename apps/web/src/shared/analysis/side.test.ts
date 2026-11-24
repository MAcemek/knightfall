import { describe, expect, it } from 'vitest';
import { resolveSide } from './side.ts';

const NO_USERS = { lichessUser: '', chesscomUser: '' };

describe('resolveSide', () => {
  it('uses importedFor, then the remembered username of the source', () => {
    const g = { source: 'lichess' as const, white: { name: 'Me' }, black: { name: 'Them' } };
    expect(resolveSide({ ...g, importedFor: 'them' }, NO_USERS)).toBe('b');
    expect(resolveSide(g, NO_USERS)).toBeNull();
    expect(resolveSide(g, { lichessUser: 'ME', chesscomUser: '' })).toBe('w');
    expect(resolveSide(g, { lichessUser: '', chesscomUser: 'me' })).toBeNull();
    expect(resolveSide({ ...g, source: 'pgn' }, { lichessUser: 'me', chesscomUser: 'me' })).toBeNull();
  });

  it('finds the side of a bot game through importedFor, never through a remembered username', () => {
    const g = { source: 'bot' as const, white: { name: 'Me' }, black: { name: 'Bot' } };
    expect(resolveSide({ ...g, importedFor: 'me' }, NO_USERS)).toBe('w');
    expect(resolveSide({ ...g, importedFor: 'BOT' }, NO_USERS)).toBe('b');
    expect(resolveSide(g, { lichessUser: 'me', chesscomUser: 'me' })).toBeNull();
    expect(resolveSide({ ...g, importedFor: 'someone else' }, { lichessUser: 'me', chesscomUser: 'me' })).toBeNull();
  });
});
