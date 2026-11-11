import { useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { ReviewItem } from '../../shared/db.ts';
import { formatInterval, listDueReviews, recordReview, removeReview, useReviewSummary } from '../../shared/progress/index.ts';
import { findPuzzle } from '../../shared/puzzleSource.ts';
import { EmptyState, Icons } from '../../shared/ui.tsx';
import { TrainSession, type TrainSource } from './TrainSession.tsx';

/** /train/review — due puzzles from the spaced-repetition queue, most overdue first. Unrated. */
export function ReviewTrainer() {
  const queue = useRef<ReviewItem[]>([]);
  const seen = useRef(new Set<string>());
  const summary = useReviewSummary();

  const source = useMemo<TrainSource>(
    () => ({
      next: async () => {
        for (;;) {
          if (!queue.current.length) queue.current = (await listDueReviews(30)).filter((i) => !seen.current.has(i.puzzleId));
          const item = queue.current.shift();
          if (!item) return null;
          seen.current.add(item.puzzleId);
          const p = await findPuzzle(item.puzzleId, item.puzzleRating);
          if (p) return p;
          // The puzzle is no longer in the bundled set: drop it from the queue and try the next one.
          await removeReview(item.puzzleId);
        }
      },
      record: async (r) => {
        const out = await recordReview(r.puzzle, { solved: r.solved, hintsUsed: r.hintsUsed, mistakes: r.mistakes, timeMs: r.timeMs });
        if (out.graduated) return 'Mastered — removed from your queue';
        if (!out.item) return null;
        const wait = formatInterval(Math.max(60_000, out.item.due - Date.now()));
        return r.solved ? `Next review in ${wait}` : `Back in ${wait}`;
      },
    }),
    [],
  );

  const nextIn = summary && summary.nextDueAt !== null ? formatInterval(Math.max(60_000, summary.nextDueAt - Date.now())) : null;

  return (
    <TrainSession
      title="Review mistakes"
      subtitle="Puzzles you missed, spaced out until they stick"
      icon={Icons.layers('h-6 w-6')}
      source={source}
      finished={
        <EmptyState
          icon={Icons.check('h-6 w-6')}
          title="All caught up"
          action={
            <Link to="/train" className="font-bold text-ember-400">
              Back to Train
            </Link>
          }
        >
          {nextIn ? `Next review in ${nextIn}.` : 'Nothing is waiting. Puzzles you miss in Puzzles, Rush or theme training show up here.'}
        </EmptyState>
      }
    />
  );
}
