import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import type { Glicko } from '@knightfall/core';
import { db, defaults, getKV, KEYS } from '../../shared/db.ts';
import { themedPuzzleNear } from '../../shared/puzzleSource.ts';
import { themeLabel } from '../../shared/themes.ts';
import { EmptyState, Icons, Pill } from '../../shared/ui.tsx';
import { useThemeRows } from '../stats/useStatsData.ts';
import type { ThemeStat } from '../stats/statsLogic.ts';
import { recordTheme } from './recordTheme.ts';
import { trainTargetRating } from './trainLogic.ts';
import { TrainSession, type TrainSource } from './TrainSession.tsx';
import { themeForTurn, weakState, weakThemes } from './weakLogic.ts';

/** /train/weak — unrated puzzles from the themes the player misses most, one theme per puzzle in turn. */
export function WeakTrainer() {
  const attempts = useLiveQuery(() => db.attempts.toArray(), []);
  const rows = useThemeRows(attempts);
  // Fixed when the session starts: every solved puzzle changes the attempts table, and the
  // session must not restart or re-pick its themes midway.
  const [picked, setPicked] = useState<ThemeStat[] | null>(null);
  const state = weakState(rows);

  useEffect(() => {
    if (picked || !rows || state !== 'ready') return;
    setPicked(weakThemes(rows));
  }, [picked, rows, state]);

  if (picked) return <WeakSession stats={picked} />;
  if (state === 'loading' || state === 'ready') return <p className="text-sm text-ink-400">Loading…</p>;
  if (state === 'need-data') {
    return (
      <EmptyState
        icon={Icons.target('h-6 w-6')}
        title="Not enough data yet"
        action={
          <Link to="/puzzles" className="font-bold text-ember-400">
            Go to Puzzles
          </Link>
        }
      >
        Solve some puzzles first. A theme counts once you have tried at least five of its puzzles.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={Icons.target('h-6 w-6')}
      title="No weak spots found"
      action={
        <Link to="/train" className="font-bold text-ember-400">
          Back to Train
        </Link>
      }
    >
      You have not missed any theme you have tried at least five times. Try theme training at a harder level.
    </EmptyState>
  );
}

function WeakSession({ stats }: { stats: ThemeStat[] }) {
  const seen = useRef(new Set<string>());
  const turn = useRef(0);

  const source = useMemo<TrainSource>(() => {
    const themes = stats.map((s) => s.theme);
    return {
      next: async () => {
        const rating = (await getKV<Glicko>(KEYS.puzzleRating, defaults.puzzleRating)).rating;
        const target = trainTargetRating(rating, 'normal');
        const start = turn.current++;
        for (let k = 0; k < themes.length; k++) {
          const p = await themedPuzzleNear(target, [themeForTurn(themes, start + k)], seen.current);
          if (p) {
            seen.current.add(p.id);
            return p;
          }
        }
        return null;
      },
      record: recordTheme,
    };
  }, [stats]);

  return (
    <TrainSession
      title="Weak spots"
      subtitle="Unrated · the themes you miss most"
      icon={Icons.target('h-6 w-6')}
      badges={
        <div className="mb-4 flex flex-wrap gap-1.5">
          {stats.map((s) => (
            <Pill key={s.theme} className="bg-ember-500/15 text-ember-400">
              {themeLabel(s.theme)} · {Math.round(s.accuracy * 100)}%
            </Pill>
          ))}
        </div>
      }
      source={source}
      finished={
        <EmptyState
          icon={Icons.target('h-6 w-6')}
          title="No more puzzles for these themes"
          action={
            <Link to="/train" className="font-bold text-ember-400">
              Back to Train
            </Link>
          }
        >
          The bundled puzzle set has nothing more for your weak themes.
        </EmptyState>
      }
    />
  );
}
