/** A chess puzzle in a normalized format shared by every mode. */
export interface Puzzle {
  id: string;
  /** Starting position (FEN). */
  fen: string;
  /** Full line in UCI notation (e.g. "e2e4", "e7e8q"). */
  moves: string[];
  /**
   * True when moves[0] is the opponent's "setup" move that is auto-played
   * before the solver moves (Lichess convention). Custom puzzles usually start
   * with the solver to move, so this is false.
   */
  opponentFirst: boolean;
  rating: number;
  themes: string[];
  source: 'lichess' | 'custom';
  title?: string;
  /** Optional link back to the originating game/puzzle. */
  gameUrl?: string;
}

/** Compact on-disk row used in public/puzzles/*.json: [id, fen, "uci uci ...", rating, "theme theme"] */
export type PuzzleRow = [string, string, string, number, string];

export function rowToPuzzle(row: PuzzleRow): Puzzle {
  const [id, fen, moves, rating, themes] = row;
  return {
    id,
    fen,
    moves: moves.split(' ').filter(Boolean),
    opponentFirst: true,
    rating,
    themes: themes ? themes.split(' ').filter(Boolean) : [],
    source: 'lichess',
    gameUrl: `https://lichess.org/training/${id}`,
  };
}

/** Index of the first move the solver has to find. */
export function firstPlayerPly(p: Puzzle): number {
  return p.opponentFirst ? 1 : 0;
}

/** Whether the move at `ply` belongs to the solver. */
export function isPlayerPly(p: Puzzle, ply: number): boolean {
  return ply % 2 === firstPlayerPly(p) % 2;
}

/** Number of moves the solver must find. */
export function playerMoveCount(p: Puzzle): number {
  let n = 0;
  for (let i = 0; i < p.moves.length; i++) if (isPlayerPly(p, i)) n++;
  return n;
}
