import { describe, expect, it } from 'vitest';
import { isLichessGameId, parseGameInput } from './gameLink.ts';

describe('parseGameInput: Lichess', () => {
  const id = 'HqjDTU4A';
  it.each([
    [`https://lichess.org/${id}`],
    [`lichess.org/${id}`],
    [`http://www.lichess.org/${id}/`],
    [`https://lichess.org/${id}?foo=1`],
    [`https://lichess.org/game/export/${id}`],
    [`https://lichess.org/game/export/${id}.pgn`],
    [`https://lichess.org/embed/game/${id}?theme=auto`],
    [`https://lichess.org/embed/${id}`],
    [id],
    [`  ${id}\n`],
  ])('%s', (input) => {
    expect(parseGameInput(input)).toEqual({ kind: 'lichess', id });
  });
  it('keeps the first 8 characters of a 12-character (player) id', () => {
    expect(parseGameInput(`https://lichess.org/${id}abcd`)).toEqual({ kind: 'lichess', id });
    expect(parseGameInput(`${id}abcd`)).toEqual({ kind: 'lichess', id });
  });
  it('reads the colour suffix and the #ply anchor', () => {
    expect(parseGameInput(`https://lichess.org/${id}/black`)).toEqual({ kind: 'lichess', id, orientation: 'black' });
    expect(parseGameInput(`https://lichess.org/${id}/white#34`)).toEqual({ kind: 'lichess', id, orientation: 'white', ply: 34 });
    expect(parseGameInput(`https://lichess.org/${id}#12`)).toEqual({ kind: 'lichess', id, ply: 12 });
  });
  it('rejects Lichess pages that are not games', () => {
    for (const bad of ['https://lichess.org/training/abc12', 'https://lichess.org/training', 'https://lichess.org/@/someone', 'https://lichess.org/study/abcdefgh/ijklmnop', 'https://lichess.org/', 'https://lichess.org/abc']) {
      expect(parseGameInput(bad).kind).toBe('error');
    }
  });
  it('isLichessGameId', () => {
    expect(isLichessGameId(id)).toBe(true);
    expect(isLichessGameId(`${id}abcd`)).toBe(false);
    expect(isLichessGameId('abc')).toBe(false);
  });
});

describe('parseGameInput: chess.com', () => {
  it.each([
    ['https://www.chess.com/game/live/184727190848', 'live', '184727190848'],
    ['chess.com/game/live/184727190848', 'live', '184727190848'],
    ['https://www.chess.com/game/daily/498765432', 'daily', '498765432'],
    ['https://www.chess.com/analysis/game/live/184727190848?tab=review', 'live', '184727190848'],
    ['https://www.chess.com/analysis/game/daily/498765432?tab=analysis&move=12', 'daily', '498765432'],
    ['https://www.chess.com/live/game/184727190848', 'live', '184727190848'],
    ['https://www.chess.com/daily/game/498765432', 'daily', '498765432'],
    ['https://www.chess.com/game/184727190848', 'live', '184727190848'],
    ['https://www.chess.com/es/game/live/184727190848', 'live', '184727190848'],
    ['https://www.chess.com/pt-BR/game/live/184727190848#b', 'live', '184727190848'],
  ])('%s', (input, type, id) => {
    expect(parseGameInput(input)).toEqual({ kind: 'chesscom', type, id });
  });
  it('rejects non-numeric ids, bot games and other pages with a helpful message', () => {
    expect(parseGameInput('https://www.chess.com/game/live/12ab').kind).toBe('error');
    expect(parseGameInput('https://www.chess.com/game/live/').kind).toBe('error');
    expect(parseGameInput('https://www.chess.com/member/someone').kind).toBe('error');
    const bot = parseGameInput('https://www.chess.com/game/computer/123456');
    expect(bot).toMatchObject({ kind: 'error' });
    expect(bot.kind === 'error' && bot.message).toMatch(/PGN/);
    expect(parseGameInput('https://www.chess.com/analysis/game/pgn/abcDEF123').kind).toBe('error');
  });
});

describe('parseGameInput: PGN and junk', () => {
  it('recognises PGN with headers', () => {
    const pgn = '[Event "Casual"]\n[White "A"]\n\n1. e4 e5 2. Nf3 *';
    expect(parseGameInput(`\n${pgn}\n`)).toEqual({ kind: 'pgn', pgn });
  });
  it('recognises bare movetext', () => {
    expect(parseGameInput('1. e4 e5 2. Nf3 Nc6')).toEqual({ kind: 'pgn', pgn: '1. e4 e5 2. Nf3 Nc6' });
    expect(parseGameInput('1.d4 d5')).toEqual({ kind: 'pgn', pgn: '1.d4 d5' });
  });
  it('recognises PGN that mentions a game link in a header', () => {
    const pgn = '[Site "https://lichess.org/HqjDTU4A"]\n\n1. e4 *';
    expect(parseGameInput(pgn).kind).toBe('pgn');
  });
  it('returns an error for empty input, other sites and nonsense', () => {
    expect(parseGameInput('   ')).toEqual({ kind: 'error', message: 'Paste a game link or a PGN.' });
    expect(parseGameInput('https://example.com/game/live/1').kind).toBe('error');
    expect(parseGameInput('hello world').kind).toBe('error');
    expect(parseGameInput('javascript:alert(1)').kind).toBe('error');
    expect(parseGameInput('ftp://lichess.org/HqjDTU4A').kind).toBe('error');
  });
});
