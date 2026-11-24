import { useMemo, useRef } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { Puzzle } from '@knightfall/core';
import { EmptyState, Icons, Pill } from '../../shared/ui.tsx';
import { TrainSession, type TrainSource } from '../train/TrainSession.tsx';
import { useLoadedSet } from './parts.tsx';
import { currentCycle, cycleProgress } from './woodLogic.ts';

/** /train/woodpecker/:id/misses: the misses of the current cycle once more. Practice only: nothing is saved. */
export function WoodMisses() {
  const { id } = useParams();
  const loaded = useLoadedSet(id);
  if (loaded.state === 'loading') {
    return (
      <p className="text-sm text-ink-400" role="status">
        Loading the set.
      </p>
    );
  }
  if (loaded.state === 'missing') return <Navigate to="/train/woodpecker" replace />;
  const { set, attempts } = loaded;
  const cur = currentCycle(set)!;
  const missed = new Set(cycleProgress(set, cur.n, attempts).misses);
  const list = set.items.filter((p) => missed.has(p.id));
  return <Practice key={`${set.id}-${cur.n}`} setId={set.id} cycle={cur.n} puzzles={list} />;
}

function Practice({ setId, cycle, puzzles }: { setId: string; cycle: number; puzzles: Puzzle[] }) {
  const index = useRef(0);
  const setPage = `/train/woodpecker/${setId}`;
  const source = useMemo<TrainSource>(
    () => ({
      next: async () => puzzles[index.current++] ?? null,
      record: async () => null,
    }),
    [puzzles],
  );

  return (
    <TrainSession
      title="Replay misses"
      subtitle={`Cycle ${cycle}. Practice only, nothing is saved.`}
      icon={Icons.retry('h-6 w-6')}
      exitTo={setPage}
      source={source}
      badges={
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Pill>Practice only</Pill>
          <Pill className="font-mono">{puzzles.length} to replay</Pill>
        </div>
      }
      finished={
        <EmptyState
          icon={Icons.check('h-6 w-6')}
          title={puzzles.length ? 'Misses replayed' : 'No misses to replay'}
          action={
            <Link to={setPage} className="font-bold text-ember-400">
              Back to the set
            </Link>
          }
        >
          {puzzles.length ? 'Nothing was saved, so your cycle numbers are unchanged.' : 'Every puzzle played so far in this cycle was solved cleanly on the first try.'}
        </EmptyState>
      }
    />
  );
}
