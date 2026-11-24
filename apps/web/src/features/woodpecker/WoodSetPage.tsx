import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Button, EmptyState, Icons, Modal, PageHeader, Panel, Pill, Stat } from '../../shared/ui.tsx';
import { inputClass, ProgressBar } from './parts.tsx';
import {
  canStartNext, compareCycles, currentCycle, cycleProgress, cycleSummaries, daysText, formatMs, formatPercent, formatTotal, MAX_NAME, pace, paceLine,
  targetDays, type CycleSummary,
} from './woodLogic.ts';
import { deleteSet, renameSet, startNext, useSetAttempts, useWoodSet } from './woodStore.ts';

/** /train/woodpecker/:id */
export function WoodSetPage() {
  const { id } = useParams();
  const set = useWoodSet(id);
  const attempts = useSetAttempts(id);
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (set === undefined || attempts === undefined) {
    return (
      <p className="text-sm text-ink-400" role="status">
        Loading the set.
      </p>
    );
  }
  if (set === null) {
    if (busy) return <Navigate to="/train/woodpecker" replace />;
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={Icons.retry('h-6 w-6')}
          title="This set is gone"
          action={
            <Link to="/train/woodpecker" className="font-bold text-ember-400">
              Back to Woodpecker
            </Link>
          }
        >
          It may have been deleted on this device.
        </EmptyState>
      </div>
    );
  }

  const cur = currentCycle(set)!;
  const p = cycleProgress(set, cur.n, attempts);
  const pc = pace(set, cur.n, attempts, Date.now());
  const rows = cycleSummaries(set, attempts);
  const finished = cur.finishedAt !== null;
  const lastDone = [...rows].reverse().find((r) => r.finished);
  const before = lastDone ? rows.find((r) => r.n === lastDone.n - 1) : undefined;
  const nextN = set.cycles.length + 1;
  const first = set.cycles[0]?.targetDays ?? 28;

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError('That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={set.name}
        subtitle={`${set.items.length} puzzles, cycle ${cur.n}`}
        icon={Icons.retry('h-6 w-6')}
        right={
          <Link to="/train/woodpecker" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition hover:text-ink-100">
            ← Woodpecker
          </Link>
        }
      />

      <Panel className="animate-rise space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Done" value={`${p.done} of ${p.total}`} sub={`target ${daysText(cur.targetDays)}`} />
          <Stat
            label="Today"
            value={finished ? '-' : `${pc.doneToday} of ${Math.max(pc.todayGoal, pc.doneToday)}`}
            sub={finished ? undefined : `day ${Math.min(pc.dayIndex, 999)} of ${cur.targetDays}`}
            accent={pc.state === 'behind' || pc.state === 'overdue' ? 'text-bad-400' : pc.state === 'ahead' ? 'text-good-400' : 'text-ink-100'}
          />
        </div>
        <ProgressBar done={p.done} total={p.total} label={`Cycle ${cur.n} progress`} />
        <p className="text-sm font-semibold text-ember-400">{finished ? `Cycle ${cur.n} is done.` : paceLine(pc)}</p>
        {error && (
          <p className="text-sm font-semibold text-bad-400" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {finished ? (
            canStartNext(set) && (
              <Button variant="primary" disabled={busy} onClick={() => void run(() => startNext(set.id))}>
                Start cycle {nextN} (target {daysText(targetDays(first, nextN))})
              </Button>
            )
          ) : (
            <Button variant="primary" onClick={() => navigate(`/train/woodpecker/${set.id}/play`)}>
              {Icons.next('h-5 w-5')} {p.done === 0 ? 'Start' : 'Continue'}
            </Button>
          )}
        </div>
      </Panel>

      {lastDone && before && <Comparison now={lastDone} before={before} />}

      <Panel className="animate-rise">
        <h2 className="mb-2 text-lg font-extrabold">Cycles</h2>
        <table className="w-full table-fixed text-left text-xs sm:text-sm">
          <caption className="sr-only">Accuracy, times and days of every cycle</caption>
          <thead className="text-ink-400">
            <tr>
              <th scope="col" className="w-[13%] py-1 pr-1 font-semibold">
                Cycle
              </th>
              <th scope="col" className="w-[21%] py-1 pr-1 font-semibold">
                Accuracy
              </th>
              <th scope="col" className="w-[20%] py-1 pr-1 font-semibold">
                Median
              </th>
              <th scope="col" className="w-[26%] py-1 pr-1 font-semibold">
                Total
              </th>
              <th scope="col" className="w-[20%] py-1 font-semibold">
                Days
              </th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((r) => (
              <tr key={r.n} className="border-t border-ink-700/60 align-top">
                <th scope="row" className="py-2 pr-1 font-bold text-ink-100">
                  {r.n}
                </th>
                <td className="py-2 pr-1">{formatPercent(r.accuracy)}</td>
                <td className="py-2 pr-1">{formatMs(r.medianMs)}</td>
                <td className="py-2 pr-1">{r.done ? formatTotal(r.totalMs) : '-'}</td>
                <td className="py-2">{daysCell(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-500">Days are shown as taken / target. Only your first try of each puzzle counts.</p>
      </Panel>

      <Panel className="animate-rise space-y-3">
        <h2 className="text-lg font-extrabold">Misses in cycle {cur.n}</h2>
        {p.misses.length === 0 ? (
          <p className="text-sm text-ink-400">{p.done === 0 ? 'Nothing played yet.' : 'No misses so far.'}</p>
        ) : (
          <>
            <p className="text-sm text-ink-400">
              A miss is a puzzle you did not solve on the first try without a hint. Replaying them is practice only and is not saved.
            </p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Missed puzzles by position in the set">
              {p.misses.map((mid) => (
                <li key={mid}>
                  <Pill className="font-mono">#{set.items.findIndex((x) => x.id === mid) + 1}</Pill>
                </li>
              ))}
            </ul>
            <Button onClick={() => navigate(`/train/woodpecker/${set.id}/misses`)}>Replay misses ({p.misses.length})</Button>
          </>
        )}
      </Panel>

      <Panel className="animate-rise">
        <h2 className="mb-2 text-lg font-extrabold">Manage</h2>
        {renaming ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await renameSet(set.id, draft);
                setRenaming(false);
              });
            }}
          >
            <label htmlFor="wood-rename" className="block text-sm font-semibold text-ink-300">
              Name
            </label>
            <input id="wood-rename" value={draft} maxLength={MAX_NAME} onChange={(e) => setDraft(e.target.value)} className={inputClass} autoComplete="off" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={busy}>
                Save name
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                setDraft(set.name);
                setRenaming(true);
              }}
            >
              Rename
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete set
            </Button>
          </div>
        )}
      </Panel>

      <Modal open={confirmDelete} onClose={busy ? undefined : () => setConfirmDelete(false)} label="Delete this set">
        <h2 className="text-lg font-extrabold">Delete this set?</h2>
        <p className="mt-2 text-sm text-ink-300">
          The set and its cycles are removed from this device. The puzzles you solved still count in your activity. This can&apos;t be undone.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await deleteSet(set.id);
                setConfirmDelete(false);
                navigate('/train/woodpecker', { replace: true });
              })
            }
          >
            Delete set
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function daysCell(r: CycleSummary): string {
  return r.days === null ? `- / ${r.targetDays}` : `${r.days} / ${r.targetDays}`;
}

function Comparison({ now, before }: { now: CycleSummary; before: CycleSummary }) {
  const c = compareCycles(before, now);
  const parts: string[] = [];
  if (c.accuracyPoints !== null) {
    parts.push(c.accuracyPoints === 0 ? 'accuracy unchanged' : `accuracy ${c.accuracyPoints > 0 ? 'up' : 'down'} ${Math.abs(c.accuracyPoints)} points`);
  }
  if (c.medianMs !== null) {
    parts.push(Math.abs(c.medianMs) < 50 ? 'median time unchanged' : `median time ${formatMs(Math.abs(c.medianMs))} ${c.medianMs < 0 ? 'faster' : 'slower'}`);
  }
  if (!parts.length) return null;
  const text = parts.join(', ');
  return (
    <Panel className="animate-rise">
      <h2 className="text-lg font-extrabold">
        Cycle {now.n} against cycle {before.n}
      </h2>
      <p className="mt-1 text-sm text-ink-300">{text.charAt(0).toUpperCase() + text.slice(1)}.</p>
    </Panel>
  );
}
