import { db } from '../../shared/db.ts';
import type { RunnerResult } from '../../shared/PuzzlePlayer/index.ts';

/** Unrated theme result: only an Attempt row. The foundation's watcher queues a miss for review. */
export async function recordTheme(r: RunnerResult): Promise<string | null> {
  await db.attempts.add({
    puzzleId: r.puzzle.id,
    mode: 'theme',
    solved: r.solved,
    puzzleRating: r.puzzle.rating,
    hintsUsed: r.hintsUsed,
    timeMs: r.timeMs,
    at: Date.now(),
    themes: r.puzzle.themes,
  });
  return r.solved ? null : 'Missed — added to your review queue';
}
