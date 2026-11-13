/** Shared types of the game-analysis feature (pure data, no engine or DOM). */

export type Side = 'w' | 'b';

/**
 * An engine score, ALWAYS from White's point of view.
 *  - { cp }: centipawns, positive = White is better.
 *  - { mate }: moves until mate, positive = White mates, negative = Black mates. Never 0.
 */
export type EvalScore = { cp: number } | { mate: number };

/** One principal variation. `pv` is UCI with standard castling notation (e1g1, never e1h1). */
export interface EngineLine {
  score: EvalScore;
  pv: string[];
}

/** Why a position has no engine lines. */
export type Terminal = 'checkmate' | 'stalemate' | 'draw';

/** The evaluation of one position. */
export interface PositionEval {
  fen: string;
  /** Search depth reached (0 for terminal positions). */
  depth: number;
  source: 'engine' | 'cloud' | 'terminal';
  /** Best first for the side to move. Empty when `terminal` is set. */
  lines: EngineLine[];
  /** = lines[0].score, or the fixed score of a terminal position. */
  score: EvalScore;
  terminal?: Terminal;
}

/** Move classes, Knightfall's own names. */
export type MoveClass =
  | 'book' | 'forced' | 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'miss';

/** Display order (best to worst; book and forced last). */
export const MOVE_CLASSES: readonly MoveClass[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder', 'book', 'forced',
];

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface AnalysedMove {
  /** 0-based index into the game's move list. evals[ply] is the position before it, evals[ply + 1] after. */
  ply: number;
  color: Side;
  /** Full-move number as printed in a score sheet. */
  moveNumber: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  class: MoveClass;
  phase: GamePhase;
  /** Win chance 0..100 of the side that moved, before and after the move. */
  winBefore: number;
  winAfter: number;
  /** 0..100. */
  accuracy: number;
  /** Centipawns lost by the mover (0 when the move kept or improved the eval). */
  cpLoss: number;
  /** The engine's first choice before the move (absent in terminal/unknown cases). */
  best?: { uci: string; san: string };
}

export interface SideNumbers {
  white: number | null;
  black: number | null;
}

export interface GameReport {
  version: 1;
  startFen: string;
  moves: AnalysedMove[];
  /** moves.length + 1 entries. */
  evals: PositionEval[];
  accuracy: SideNumbers;
  acpl: SideNumbers;
  counts: { white: Record<MoveClass, number>; black: Record<MoveClass, number> };
  phases: Record<GamePhase, SideNumbers>;
  /** Up to 3 plies with the largest win-chance swings, in game order. */
  keyMoments: number[];
  /** Deepest opening-table hit. */
  opening: { eco: string; name: string; ply: number } | null;
}

/** EPD (first four FEN fields) -> [eco, name]. Built by scripts/build-openings.mjs. */
export type OpeningTable = Record<string, [string, string]>;

/* ---------- HTTP API of apps/server (shared so client and server cannot drift) ---------- */

export type ChesscomGameType = 'live' | 'daily';

export interface ChesscomPlayer {
  username: string;
  rating?: number;
}

/** 200 body of GET /api/chesscom/game/:type/:id */
export interface ChesscomGameResponse {
  pgn: string;
  url: string;
  white: ChesscomPlayer;
  black: ChesscomPlayer;
  accuracies?: { white: number; black: number };
  timeClass?: string;
  /** Epoch seconds. */
  endTime?: number;
}

export type ApiErrorCode = 'bad_request' | 'not_found' | 'not_finished' | 'rate_limited' | 'timeout' | 'upstream';

/** Non-200 body of every /api route. `fallback` tells the UI which manual path to offer. */
export interface ApiErrorResponse {
  error: string;
  code: ApiErrorCode;
  fallback: 'username' | 'pgn';
}
