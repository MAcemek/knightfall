import { useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GAME_PUZZLE_PREFIX } from '@knightfall/core';
import { orderGamePuzzles } from '../../shared/analysis/index.ts';
import { db } from '../../shared/db.ts';
import { recordReview } from '../../shared/progress/index.ts';
import { EmptyState, Icons } from '../../shared/ui.tsx';
import { reviewOutcomeLine } from './trainLogic.ts';
import { TrainSession, type TrainSource } from './TrainSession.tsx';

/**
 * /train/games/play?m=due|all — puzzles made from your own analysed games. Due ones come first (most
 * overdue first); "all" then continues with the rest. Unrated; results feed the spaced-repetition queue.
 */
export function GamesTrainer() {
  const [params] = useSearchParams();
  const mode = params.get('m') === 'all' ? 'all' : 'due';
  const queue = useRef<string[] | null>(null);

  const source = useMemo<TrainSource>(
    () => ({
      next: async () => {
        if (!queue.current) {
          const ids = (await db.customPuzzles.where('id').startsWith(GAME_PUZZLE_PREFIX).primaryKeys()) as string[];
          queue.current = orderGamePuzzles(ids, await db.reviews.toArray(), Date.now(), mode);
        }
        while (queue.current.length) {
          const p = await db.customPuzzles.get(queue.current.shift()!);
          if (p) return p;
        }
        return null;
      },
      record: async (r) => reviewOutcomeLine(await recordReview(r.puzzle, { solved: r.solved, hintsUsed: r.hintsUsed, mistakes: r.mistakes, timeMs: r.timeMs }), r.solved, Date.now()),
    }),
    [mode],
  );

  return (
    <TrainSession
      title="From my games"
      subtitle="Positions where you went wrong, played again"
      icon={Icons.target('h-6 w-6')}
      source={source}
      finished={
        <EmptyState
          icon={Icons.check('h-6 w-6')}
          title={mode === 'due' ? 'Nothing due' : 'That was all of them'}
          action={
            <Link to="/train/games" className="font-bold text-ember-400">
              Back to From my games
            </Link>
          }
        >
          {mode === 'due' ? 'Your game puzzles are spaced out until they are due again. Practise all to play them anyway.' : 'Analyse more games to find more puzzles.'}
        </EmptyState>
      }
    />
  );
}
