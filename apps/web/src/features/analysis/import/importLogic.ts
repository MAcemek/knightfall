import { parseGameInput } from '@knightfall/core';
import type { GamePlayer, StoredGame } from '../../../shared/db.ts';

/** Pure helpers of the import screen (no React, no IndexedDB, no network). */

export type InputKind = 'empty' | 'lichess' | 'chesscom' | 'pgn' | 'invalid';

/** What the paste box currently holds, for the live hint under it. */
export function inputKind(text: string): InputKind {
  if (!text.trim()) return 'empty';
  const parsed = parseGameInput(text);
  return parsed.kind === 'error' ? 'invalid' : parsed.kind;
}

export const INPUT_HINT: Record<InputKind, string> = {
  empty: 'Paste a Lichess or chess.com game link, or a PGN.',
  lichess: 'Lichess game link',
  chesscom: 'chess.com game link',
  pgn: 'PGN',
  invalid: 'That does not look like a game link or a PGN.',
};

export type Outcome = 'win' | 'loss' | 'draw' | 'unknown';

/** The game's result from one side's view. `side` null (not the user's game) gives 'unknown'. */
export function outcomeFor(game: Pick<StoredGame, 'result'>, side: 'w' | 'b' | null): Outcome {
  if (!side || game.result === '*') return 'unknown';
  if (game.result === '1/2-1/2') return 'draw';
  return (game.result === '1-0') === (side === 'w') ? 'win' : 'loss';
}

export function opponentOf(game: Pick<StoredGame, 'white' | 'black'>, side: 'w' | 'b'): GamePlayer {
  return side === 'w' ? game.black : game.white;
}

/** "Alice (1510)" or "Alice". */
export function playerLabel(p: GamePlayer): string {
  return p.rating !== undefined ? `${p.name} (${Math.round(p.rating)})` : p.name;
}

/** "Blitz · 180+0", "Rapid", "180+0" or "". */
export function speedLabel(game: Pick<StoredGame, 'speed' | 'timeControl'>): string {
  const speed = game.speed ? game.speed.charAt(0).toUpperCase() + game.speed.slice(1) : '';
  return [speed, game.timeControl ?? ''].filter(Boolean).join(' · ');
}

/** Full moves played: 7 plies -> 4. */
export function moveCount(plies: number): number {
  return Math.ceil(plies / 2);
}

const DAY = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "3 days ago", or the date (YYYY-MM-DD) for anything older than a week. Local time. */
export function playedLabel(playedAt: number, now: number): string {
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(playedAt)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(playedAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
