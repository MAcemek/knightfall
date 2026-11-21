import type { StoredGame } from '../db.ts';

/** Which side of a game the user played (shared by Insights, Game Review and game-puzzle practice). */

export interface KnownUsers {
  lichessUser: string;
  chesscomUser: string;
}

/** The side the user played, from the imported username; null when unknown. */
export function userSide(game: { white: { name: string }; black: { name: string }; importedFor?: string }): 'w' | 'b' | null {
  const me = game.importedFor?.trim().toLowerCase();
  if (!me) return null;
  const w = game.white.name.toLowerCase() === me;
  const b = game.black.name.toLowerCase() === me;
  return w === b ? null : w ? 'w' : 'b';
}

/**
 * The side the user played: the username the game was imported for, or else the remembered username of that
 * site (analysis prefs). Null when neither matches (pasted games, other players' games).
 */
export function resolveSide(game: Pick<StoredGame, 'source' | 'white' | 'black' | 'importedFor'>, users: KnownUsers): 'w' | 'b' | null {
  const fromImport = userSide(game);
  if (fromImport) return fromImport;
  const remembered = game.source === 'lichess' ? users.lichessUser : game.source === 'chesscom' ? users.chesscomUser : '';
  return remembered ? userSide({ white: game.white, black: game.black, importedFor: remembered }) : null;
}
