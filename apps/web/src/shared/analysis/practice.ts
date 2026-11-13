import { mistakePuzzles, type GameReport, type Puzzle } from '@knightfall/core';
import { db, type CustomPuzzle, type StoredGame } from '../db.ts';
import { newReview } from '../progress/srs.ts';

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

export async function addMistakesToPractice(game: StoredGame, report: GameReport, side: 'w' | 'b'): Promise<PracticeResult> {
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
      .filter((_, i) => !haveReview[i])
      .map((p) => ({ ...newReview({ puzzleId: p.id, puzzleRating: p.rating, themes: p.themes }, now), due: now }));
    if (rows.length) await db.customPuzzles.bulkPut(rows);
    if (reviews.length) await db.reviews.bulkPut(reviews);
    return { total: puzzles.length, added: rows.length, queued: reviews.length };
  });
}
