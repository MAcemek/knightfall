import { describe, expect, it } from 'vitest';
import { INPUT_HINT, inputKind, moveCount, opponentOf, outcomeFor, playedLabel, playerLabel, speedLabel } from './importLogic.ts';

describe('inputKind', () => {
  it('names what was pasted', () => {
    expect(inputKind('   ')).toBe('empty');
    expect(inputKind('https://lichess.org/HqjDTU4A')).toBe('lichess');
    expect(inputKind('https://www.chess.com/game/live/123')).toBe('chesscom');
    expect(inputKind('1. e4 e5')).toBe('pgn');
    expect(inputKind('hello there')).toBe('invalid');
    expect(Object.keys(INPUT_HINT).sort()).toEqual(['chesscom', 'empty', 'invalid', 'lichess', 'pgn']);
  });
});

describe('outcomeFor', () => {
  it('reads the result from one side', () => {
    expect(outcomeFor({ result: '1-0' }, 'w')).toBe('win');
    expect(outcomeFor({ result: '1-0' }, 'b')).toBe('loss');
    expect(outcomeFor({ result: '0-1' }, 'b')).toBe('win');
    expect(outcomeFor({ result: '1/2-1/2' }, 'w')).toBe('draw');
    expect(outcomeFor({ result: '*' }, 'w')).toBe('unknown');
    expect(outcomeFor({ result: '1-0' }, null)).toBe('unknown');
  });
});

describe('labels', () => {
  const game = { white: { name: 'Alice', rating: 1510.4 }, black: { name: 'Bob' } };
  it('opponentOf and playerLabel', () => {
    expect(opponentOf(game, 'w').name).toBe('Bob');
    expect(opponentOf(game, 'b').name).toBe('Alice');
    expect(playerLabel(game.white)).toBe('Alice (1510)');
    expect(playerLabel(game.black)).toBe('Bob');
  });
  it('speedLabel', () => {
    expect(speedLabel({ speed: 'blitz', timeControl: '180+0' })).toBe('Blitz · 180+0');
    expect(speedLabel({ speed: 'rapid' })).toBe('Rapid');
    expect(speedLabel({ timeControl: '600' })).toBe('600');
    expect(speedLabel({})).toBe('');
  });
  it('moveCount', () => {
    expect(moveCount(7)).toBe(4);
    expect(moveCount(8)).toBe(4);
    expect(moveCount(0)).toBe(0);
  });
  it('playedLabel', () => {
    const now = new Date(2026, 10, 12, 15, 0).getTime();
    expect(playedLabel(new Date(2026, 10, 12, 0, 5).getTime(), now)).toBe('today');
    expect(playedLabel(new Date(2026, 10, 11, 23, 55).getTime(), now)).toBe('yesterday');
    expect(playedLabel(new Date(2026, 10, 9, 12, 0).getTime(), now)).toBe('3 days ago');
    expect(playedLabel(new Date(2026, 9, 2, 12, 0).getTime(), now)).toBe('2026-10-02');
    expect(playedLabel(now + 5000, now)).toBe('today');
  });
});
