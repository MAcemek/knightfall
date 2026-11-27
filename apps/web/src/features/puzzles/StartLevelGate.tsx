import { useEffect, useState, type ReactNode } from 'react';
import type { Glicko } from '@knightfall/core';
import { db, defaults, getKV, KEYS, setKV } from '../../shared/db.ts';
import { Button, Icons, PageHeader, Panel } from '../../shared/ui.tsx';
import { shouldOfferStartLevel, startRating, START_LEVELS, type StartLevel } from './startLevel.ts';

type Gate = 'checking' | 'ask' | 'open';

/** Shows the one-time starting-level choice before the first rated puzzle; everyone else goes straight through. */
export function StartLevelGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('checking');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let ask = false;
      try {
        const [count, rating] = await Promise.all([
          db.attempts.where('mode').equals('rated').count(),
          getKV<Glicko>(KEYS.puzzleRating, defaults.puzzleRating),
        ]);
        ask = shouldOfferStartLevel(count, rating);
      } catch {
        /* storage unavailable: skip the choice */
      }
      if (alive) setGate(ask ? 'ask' : 'open');
    })();
    return () => {
      alive = false;
    };
  }, []);

  const choose = async (level: StartLevel) => {
    setSaving(true);
    try {
      await setKV(KEYS.puzzleRating, startRating(level));
    } catch {
      /* keep the default rating */
    }
    setGate('open');
  };

  if (gate === 'checking') return null;
  if (gate === 'open') return <>{children}</>;
  return (
    <>
      <PageHeader title="Puzzles" subtitle="Rated tactics matched to your level" icon={Icons.puzzle('h-6 w-6')} />
      <Panel className="mx-auto max-w-md space-y-4">
        <div>
          <h2 className="text-lg font-extrabold">Where do you want to start?</h2>
          <p className="mt-1 text-sm text-ink-300">Pick a level for your first puzzles. Your rating adjusts from there.</p>
        </div>
        <div className="flex flex-col gap-2">
          {START_LEVELS.map((l) => (
            <Button key={l.id} variant={l.id === 'club' ? 'primary' : 'secondary'} size="lg" disabled={saving} onClick={() => void choose(l)}>
              {l.label} ({l.rating})
            </Button>
          ))}
        </div>
        <p className="text-center text-xs text-ink-400">Not sure? Pick Club player.</p>
      </Panel>
    </>
  );
}
