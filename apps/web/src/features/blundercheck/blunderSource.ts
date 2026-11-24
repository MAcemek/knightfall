import { DEFAULT_GLICKO, type PositionEval, type Puzzle } from '@knightfall/core';
import { db, getKV, KEYS } from '../../shared/db.ts';
import { getAnalysisPrefs } from '../../shared/analysis/store.ts';
import { AbortError, getEnginePool, isAbortError } from '../../shared/engine/index.ts';
import { puzzleNear } from '../../shared/puzzleSource.ts';
import { fenAfterMove, fromGames, fromPuzzle, gamesUsable, makeAlternator, makeDeck, type CheckItem, type CheckSource, type GameRow, type Rng } from './blunderLogic.ts';

/** Prepares Blunder check items: from the player's reviewed games, or from rated puzzles checked by the engine. */

/** Reviewed games read for the drill (newest first). */
const MAX_GAMES = 60;
/** Puzzles tried before giving up on one item. */
const MAX_TRIES = 6;
const DEPTH = 14;
const LINES = 4;

export async function loadGameRows(): Promise<GameRow[]> {
  const analyses = await db.analyses.orderBy('analysedAt').reverse().limit(MAX_GAMES).toArray();
  const games = await db.games.bulkGet(analyses.map((a) => a.gameKey));
  const rows: GameRow[] = [];
  analyses.forEach((a, i) => {
    const game = games[i];
    if (game && a.report && Array.isArray(a.report.moves) && Array.isArray(a.report.evals)) rows.push({ game, report: a.report });
  });
  return rows;
}

/** Every usable item of the player's reviewed games. */
export async function loadGameItems(): Promise<CheckItem[]> {
  const [prefs, rows] = await Promise.all([getAnalysisPrefs(), loadGameRows()]);
  return fromGames(rows, prefs);
}

/** The puzzle rating from storage (a damaged value gives the default). */
async function puzzleRating(): Promise<number> {
  const raw = await getKV<unknown>(KEYS.puzzleRating, null);
  const r = raw && typeof raw === 'object' ? (raw as { rating?: unknown }).rating : null;
  return typeof r === 'number' && Number.isFinite(r) ? Math.max(400, Math.min(3200, r)) : DEFAULT_GLICKO.rating;
}

export interface Feed {
  /** The next item. Rejects with an AbortError after `signal` aborted; any other error can be retried by calling again. */
  next(): Promise<CheckItem>;
}

/**
 * A feed of items. The item after the current one is prepared in the background while the current one is played.
 * Games are read once; puzzles are checked by the engine the player prefers (never a hard-coded build).
 */
export function createFeed(source: CheckSource, signal: AbortSignal, rand: Rng = Math.random): Feed {
  const wantBlunder = makeAlternator(rand);
  const used = new Set<string>();
  let deck: Promise<ReturnType<typeof makeDeck>> | null = null;

  const gameDeck = () => {
    deck ??= loadGameItems().then((items) => {
      if (!gamesUsable(items)) throw new Error('Not enough reviewed positions yet.');
      return makeDeck(items, rand);
    });
    deck.catch(() => {
      deck = null;
    });
    return deck;
  };

  const evaluate = (fen: string): Promise<PositionEval> =>
    getAnalysisPrefs().then((prefs) => getEnginePool(prefs.engine).evaluate({ fen, depth: DEPTH, multiPv: LINES, fresh: true, priority: 5, signal }));

  async function prepareGame(): Promise<CheckItem> {
    const item = (await gameDeck()).next();
    if (signal.aborted) throw new AbortError();
    if (!item) throw new Error('Not enough reviewed positions yet.');
    return item;
  }

  async function preparePuzzle(): Promise<CheckItem> {
    const blunder = wantBlunder();
    const rating = await puzzleRating();
    for (let i = 0; i < MAX_TRIES; i++) {
      if (signal.aborted) throw new AbortError();
      const puzzle: Puzzle = await puzzleNear(rating - 100, used);
      used.add(puzzle.id);
      if (!puzzle.opponentFirst || puzzle.moves.length < 2) continue;
      const afterFen = fenAfterMove(puzzle.fen, puzzle.moves[0]);
      if (!afterFen) continue;
      const [before, after] = await Promise.all([evaluate(puzzle.fen), evaluate(afterFen)]);
      if (signal.aborted) throw new AbortError();
      const item = fromPuzzle(puzzle, before, after, blunder, rand);
      if (item) return item;
    }
    throw new Error('Could not prepare a position.');
  }

  const prepare = source === 'games' ? prepareGame : preparePuzzle;
  let ahead: Promise<CheckItem> | null = null;
  let inflight: Promise<CheckItem> | null = null;

  return {
    next() {
      // One call at a time: a second call while one is running gets the same answer.
      if (inflight) return inflight;
      const current = ahead ?? prepare();
      ahead = null;
      const run = current.then(
        (item) => {
          if (!signal.aborted) {
            ahead = prepare();
            ahead.catch(() => {}); // an error here is reported when the next item is asked for
          }
          return item;
        },
      );
      inflight = run;
      const clear = () => {
        if (inflight === run) inflight = null;
      };
      run.then(clear, clear);
      return run;
    },
  };
}

export { isAbortError };
