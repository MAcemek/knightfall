import { useEffect, useState } from 'react';
import type { Attempt, WoodSet } from '../../shared/db.ts';
import { getSet, readSetAttempts } from './woodStore.ts';

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-ink-800" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className="h-full rounded-full bg-ember-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

export const inputClass =
  'w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 font-semibold text-ink-100 outline-none transition placeholder:font-normal placeholder:text-ink-500 focus:border-ember-500 max-lg:min-h-11';

export type Loaded = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; set: WoodSet; attempts: Attempt[] };

/** Reads a set and its attempts once when the page opens. A play session must not change under itself while it runs. */
export function useLoadedSet(id: string | undefined): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setLoaded({ state: 'loading' });
    void (async () => {
      const set = id ? await getSet(id) : null;
      if (!set) return cancelled ? undefined : setLoaded({ state: 'missing' });
      const attempts = await readSetAttempts(set.id);
      if (!cancelled) setLoaded({ state: 'ready', set, attempts });
    })().catch(() => {
      if (!cancelled) setLoaded({ state: 'missing' });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return loaded;
}
