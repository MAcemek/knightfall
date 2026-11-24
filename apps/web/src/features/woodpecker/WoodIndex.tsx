import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useNextPicks } from '../../shared/woodNext.ts';
import { Button, EmptyState, Icons, PageHeader, Panel, Pill, Segmented } from '../../shared/ui.tsx';
import { ProgressBar, inputClass } from './parts.tsx';
import {
  clampFirstDays, currentCycle, cycleProgress, DEFAULT_FIRST_DAYS, DEFAULT_SIZE, MAX_FIRST_DAYS, MAX_NAME, MIN_FIRST_DAYS, ownCounts, pace, paceLine, SET_SIZES,
} from './woodLogic.ts';
import { createSet, useAllWoodAttempts, useOwnPuzzles, useWoodSets } from './woodStore.ts';

const SIZE_OPTIONS = SET_SIZES.map((n) => ({ id: String(n), label: String(n) }));

/** /train/woodpecker: your sets and a form for a new one. */
export function WoodIndex() {
  const sets = useWoodSets();
  const attempts = useAllWoodAttempts();
  const [creating, setCreating] = useState(false);
  const showForm = creating || sets?.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Woodpecker"
        subtitle="One fixed set of puzzles, solved again and again, faster every time"
        icon={Icons.retry('h-6 w-6')}
        right={
          <Link to="/train" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition hover:text-ink-100">
            ← Train
          </Link>
        }
      />

      {sets === undefined || attempts === undefined ? (
        <p className="text-sm text-ink-400" role="status">
          Loading your sets.
        </p>
      ) : (
        <div className="space-y-4">
          {sets.length > 0 && (
            <ul className="grid gap-3">
              {sets.map((s, i) => {
                const cur = currentCycle(s)!;
                const list = attempts.get(s.id) ?? [];
                const p = cycleProgress(s, cur.n, list);
                const line = cur.finishedAt !== null ? `Cycle ${cur.n} done. Start the next one on the set page.` : paceLine(pace(s, cur.n, list, Date.now()));
                return (
                  <li key={s.id} style={{ animationDelay: `${i * 40}ms` }} className="animate-rise">
                    <Link
                      to={`/train/woodpecker/${s.id}`}
                      className="block rounded-2xl border border-ink-700/60 bg-ink-850 p-4 shadow-xl shadow-black/20 transition-colors hover:border-ink-500 hover:bg-ink-800/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="min-w-0 break-words text-lg font-extrabold leading-tight">{s.name}</h2>
                        <Pill className="shrink-0">Cycle {cur.n}</Pill>
                      </div>
                      <p className="mt-0.5 text-sm text-ink-400">
                        {s.items.length} puzzles, {p.done} of {p.total} done in this cycle
                      </p>
                      <div className="mt-3">
                        <ProgressBar done={p.done} total={p.total} label={`${s.name}, cycle ${cur.n} progress`} />
                      </div>
                      <p className="mt-2 text-sm font-semibold text-ember-400">{line}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {sets.length === 0 && (
            <EmptyState icon={Icons.retry('h-6 w-6')} title="No sets yet">
              A set is a fixed list of puzzles. You solve all of them, then all of them again in fewer days, until the patterns are automatic.
            </EmptyState>
          )}

          {showForm ? (
            <NewSetForm onCancel={sets.length > 0 ? () => setCreating(false) : undefined} />
          ) : (
            <Button variant="primary" onClick={() => setCreating(true)}>
              New set
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function NewSetForm({ onCancel }: { onCancel?: () => void }) {
  const navigate = useNavigate();
  const picks = useNextPicks();
  const own = useOwnPuzzles();
  const [name, setName] = useState('');
  const [size, setSize] = useState(String(DEFAULT_SIZE));
  const [days, setDays] = useState(String(DEFAULT_FIRST_DAYS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = picks && own ? ownCounts(picks, own, Number(size)) : null;
  const note = counts
    ? counts.picked + counts.games === 0
      ? 'No puzzles from your own games yet. The set is filled from the puzzle library near your rating.'
      : `${counts.games} ${counts.games === 1 ? 'puzzle' : 'puzzles'} from your games and ${counts.picked} picked ${counts.picked === 1 ? 'blunder' : 'blunders'} will go in. The rest comes from the puzzle library, up to 200 points below your puzzle rating.`
    : 'Checking your own puzzles.';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const set = await createSet({ name, size: Number(size), firstTargetDays: clampFirstDays(days) });
      navigate(`/train/woodpecker/${set.id}`);
    } catch (err) {
      setError((err as Error).message || 'The set could not be made. Try again.');
      setBusy(false);
    }
  };

  return (
    <Panel className="animate-rise">
      <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-busy={busy}>
        <h2 className="text-lg font-extrabold">New set</h2>
        <div>
          <label htmlFor="wood-name" className="mb-1 block text-sm font-semibold text-ink-300">
            Name
          </label>
          <input id="wood-name" value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} placeholder="Woodpecker set" className={inputClass} disabled={busy} autoComplete="off" />
        </div>
        <div>
          <div className="mb-1 text-sm font-semibold text-ink-300">Number of puzzles</div>
          <Segmented label="Number of puzzles" options={SIZE_OPTIONS} value={size} onChange={setSize} />
        </div>
        <div>
          <label htmlFor="wood-days" className="mb-1 block text-sm font-semibold text-ink-300">
            Days for the first cycle
          </label>
          <input
            id="wood-days"
            type="number"
            inputMode="numeric"
            min={MIN_FIRST_DAYS}
            max={MAX_FIRST_DAYS}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onBlur={() => setDays(String(clampFirstDays(days)))}
            className={`${inputClass} max-w-32`}
            disabled={busy}
            aria-describedby="wood-days-hint"
          />
          <p id="wood-days-hint" className="mt-1 text-xs text-ink-500">
            From 1 to 90. Every later cycle gets half the days: 28, 14, 7, 4, 2, 1.
          </p>
        </div>
        <p className="text-sm text-ink-400">{note}</p>
        {error && (
          <p className="text-sm font-semibold text-bad-400" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Building the set...' : 'Create set'}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}
