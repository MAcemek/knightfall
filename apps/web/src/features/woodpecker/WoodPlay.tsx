import { useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { WoodSet } from '../../shared/db.ts';
import { EmptyState, Icons, Pill } from '../../shared/ui.tsx';
import { TrainSession, type TrainSource } from '../train/TrainSession.tsx';
import { useLoadedSet } from './parts.tsx';
import { currentCycle, daysText, firstAttempts } from './woodLogic.ts';
import { recordWood } from './woodStore.ts';

/** /train/woodpecker/:id/play: the current cycle, first unplayed puzzle first. Reloading resumes there. */
export function WoodPlay() {
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
  const cur = currentCycle(loaded.set)!;
  const playedIds = [...firstAttempts(loaded.set, cur.n, loaded.attempts).keys()];
  return <Session key={`${loaded.set.id}-${cur.n}`} set={loaded.set} cycle={cur.n} target={cur.targetDays} playedIds={playedIds} />;
}

function Session({ set, cycle, target, playedIds }: { set: WoodSet; cycle: number; target: number; playedIds: string[] }) {
  /** Updated in record() before the write starts, so next() never serves a puzzle whose result is still being saved. */
  const played = useRef(new Set(playedIds));
  const [done, setDone] = useState(played.current.size);
  const total = set.items.length;
  const setPage = `/train/woodpecker/${set.id}`;

  const source = useMemo<TrainSource>(
    () => ({
      next: async () => set.items.find((p) => !played.current.has(p.id)) ?? null,
      record: async (r) => {
        const pid = r.puzzle.id;
        if (played.current.has(pid)) return null;
        played.current.add(pid);
        setDone(played.current.size);
        try {
          return await recordWood(set.id, cycle, r);
        } catch (e) {
          // Not saved: the puzzle comes up again instead of being lost from the cycle.
          played.current.delete(pid);
          setDone(played.current.size);
          throw e;
        }
      },
    }),
    [set, cycle],
  );

  return (
    <TrainSession
      title={set.name}
      subtitle={`Cycle ${cycle}, target ${daysText(target)}`}
      icon={Icons.retry('h-6 w-6')}
      exitTo={setPage}
      source={source}
      badges={
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Pill>Cycle {cycle}</Pill>
          <Pill className="font-mono">
            {done} of {total} done
          </Pill>
        </div>
      }
      finished={
        <EmptyState
          icon={Icons.check('h-6 w-6')}
          title={`Cycle ${cycle} done`}
          action={
            <Link to={setPage} className="font-bold text-ember-400">
              Back to the set
            </Link>
          }
        >
          Your times and misses are on the set page, where you can start the next cycle.
        </EmptyState>
      }
    />
  );
}
