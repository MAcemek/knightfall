import { useMemo, useRef } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { Glicko } from '@knightfall/core';
import { db, defaults, getKV, KEYS } from '../../shared/db.ts';
import { themedPuzzleNear } from '../../shared/puzzleSource.ts';
import { themeLabel } from '../../shared/themes.ts';
import { EmptyState, Icons, Pill } from '../../shared/ui.tsx';
import { DIFFICULTIES, parseDifficulty, parseThemeParam, trainTargetRating } from './trainLogic.ts';
import { TrainSession, type TrainSource } from './TrainSession.tsx';

/** /train/theme/:keys — unrated puzzles that match any of the chosen themes, near the player's level. */
export function ThemeTrainer() {
  const { keys } = useParams();
  const [params] = useSearchParams();
  const themes = useMemo(() => parseThemeParam(keys), [keys]);
  const difficulty = parseDifficulty(params.get('d'));
  const seen = useRef(new Set<string>());

  const source = useMemo<TrainSource>(
    () => ({
      next: async () => {
        const rating = (await getKV<Glicko>(KEYS.puzzleRating, defaults.puzzleRating)).rating;
        const p = await themedPuzzleNear(trainTargetRating(rating, difficulty), themes, seen.current);
        if (p) seen.current.add(p.id);
        return p;
      },
      record: async (r) => {
        // Unrated: only an Attempt row. The foundation's watcher queues a miss for review.
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
      },
    }),
    [themes, difficulty],
  );

  if (!themes.length) return <Navigate to="/train" replace />;

  return (
    <TrainSession
      title="Theme training"
      subtitle="Unrated · puzzles near your level"
      icon={Icons.target('h-6 w-6')}
      badges={
        <div className="mb-4 flex flex-wrap gap-1.5">
          {themes.map((t) => (
            <Pill key={t} className="bg-ember-500/15 text-ember-400">
              {themeLabel(t)}
            </Pill>
          ))}
          <Pill>{DIFFICULTIES.find((d) => d.id === difficulty)?.label}</Pill>
        </div>
      }
      source={source}
      finished={
        <EmptyState
          icon={Icons.target('h-6 w-6')}
          title="No puzzles for this theme"
          action={
            <Link to="/train" className="font-bold text-ember-400">
              Pick another theme
            </Link>
          }
        >
          The bundled puzzle set has nothing for this combination.
        </EmptyState>
      }
    />
  );
}
