import { GAME_PUZZLE_PREFIX, mistakePuzzles, type GameReport, type Puzzle } from '@knightfall/core';
import { resolveSide } from './side.ts';
import { db, type CustomPuzzle, type StoredGame } from '../db.ts';
import { newReview } from '../progress/srs.ts';
import { getSettings } from '../settings.ts';
import { planBulkAdd, type BulkAddRow } from './gamePuzzleLogic.ts';
import { getAnalysisPrefs } from './store.ts';

/**
 * "Practice your mistakes": turn one side's blunders, mistakes and misses into puzzles, store them in
 * customPuzzles (themes: 'from-game' + the class, ids "game-<gameKey>-<ply>") and put them in the
 * spaced-repetition queue, due immediately. They then show up in Train -> Review mistakes, which finds
 * them through findPuzzle() (shared/puzzleSource.ts resolves "game-" ids from customPuzzles).
 */

export interface PracticeResult {
  /** Puzzles this game yields for that side. */
  total: number;
  /** Newly stored now (the rest were already there from an earlier click). */
  added: number;
  /** Rows put (back) into the review queue. */
  queued: number;
}

/** Preview without writing anything (used to label the button: "Practice 3 mistakes"). */
export function practicePuzzles(game: StoredGame, report: GameReport, side: 'w' | 'b'): Puzzle[] {
  const me = side === 'w' ? game.white : game.black;
  const opponent = side === 'w' ? game.black : game.white;
  return mistakePuzzles(report, { gameKey: game.key, side, rating: me.rating ?? 1500, label: `vs ${opponent.name}` });
}

/**
 * `onlyNew` (automatic and bulk adds): only puzzles that are stored for the first time go into the review
 * queue, so a puzzle already mastered is not queued again by a re-analysis.
 */
export async function addMistakesToPractice(game: StoredGame, report: GameReport, side: 'w' | 'b', opts: { onlyNew?: boolean } = {}): Promise<PracticeResult> {
  const puzzles = practicePuzzles(game, report, side);
  if (!puzzles.length) return { total: 0, added: 0, queued: 0 };
  const now = Date.now();
  const author = (side === 'w' ? game.white : game.black).name;
  return db.transaction('rw', db.customPuzzles, db.reviews, async () => {
    const ids = puzzles.map((p) => p.id);
    const havePuzzle = await db.customPuzzles.bulkGet(ids);
    const haveReview = await db.reviews.bulkGet(ids);
    const rows: CustomPuzzle[] = puzzles
      .filter((_, i) => !havePuzzle[i])
      .map((p, i) => ({ ...p, source: 'custom' as const, gameUrl: game.url, createdAt: now + i, updatedAt: now + i, author, plays: 0, solves: 0 }));
    const reviews = puzzles
      .filter((_, i) => !haveReview[i] && (!opts.onlyNew || !havePuzzle[i]))
      .map((p) => ({ ...newReview({ puzzleId: p.id, puzzleRating: p.rating, themes: p.themes }, now), due: now }));
    if (rows.length) await db.customPuzzles.bulkPut(rows);
    if (reviews.length) await db.reviews.bulkPut(reviews);
    return { total: puzzles.length, added: rows.length, queued: reviews.length };
  });
}

/** After a fresh analysis: when "autoGamePuzzles" is on and the side is known, add the game's mistakes to Train. */
export async function autoAddGamePuzzles(game: StoredGame, report: GameReport): Promise<PracticeResult | null> {
  if (!getSettings().autoGamePuzzles) return null;
  const side = resolveSide(game, await getAnalysisPrefs());
  return side ? addMistakesToPractice(game, report, side, { onlyNew: true }) : null;
}

async function bulkPlan() {
  const [analyses, prefs, existing] = await Promise.all([
    db.analyses.toArray(),
    getAnalysisPrefs(),
    db.customPuzzles.where('id').startsWith(GAME_PUZZLE_PREFIX).primaryKeys(),
  ]);
  const games = await db.games.bulkGet(analyses.map((a) => a.gameKey));
  const rows: BulkAddRow[] = analyses.flatMap((a, i) => (games[i] ? [{ game: games[i]!, report: a.report }] : []));
  return planBulkAdd(rows, prefs, new Set(existing as string[]));
}

/** How many puzzles "Add from all analysed games" would add (games with an unknown side are skipped). */
export async function countNewGamePuzzles(): Promise<number> {
  return (await bulkPlan()).newCount;
}

/** Add the mistakes of every analysed game whose side is known; puzzles already stored are skipped. Returns how many were added. */
export async function addAllGamePuzzles(): Promise<number> {
  const { items } = await bulkPlan();
  let added = 0;
  for (const it of items) added += (await addMistakesToPractice(it.game, it.report, it.side, { onlyNew: true })).added;
  return added;
}
