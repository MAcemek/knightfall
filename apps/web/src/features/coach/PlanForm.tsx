import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../shared/ui.tsx';
import { inputClass } from '../woodpecker/parts.tsx';
import { planFromForm, withBaseline, withFetched, withTarget, type FormState } from './formLogic.ts';
import { cleanUsername, COACH_SPEEDS, SPEED_LABEL, type CoachPlan } from './planLogic.ts';
import { fetchChesscomStats } from './sync.ts';

/** The plan form, used to set up a plan and to change it. The rules are in formLogic.ts. */

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.');

export function PlanForm({ initial, submitLabel, onSubmit, note }: {
  initial: FormState;
  submitLabel: string;
  /** Saves the plan. Resolves to an error text, or null when it worked. */
  onSubmit: (plan: CoachPlan) => Promise<string | null>;
  note?: string;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  const typed = useRef('');
  typed.current = cleanUsername(form.username);
  const id = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchRatings = async () => {
    const user = cleanUsername(form.username);
    if (!user) {
      setFetchNote('Type a chess.com username first.');
      return;
    }
    setFetching(true);
    setFetchNote(null);
    try {
      const ratings = await fetchChesscomStats(user);
      if (!alive.current) return;
      // The box changed while chess.com was answering: these ratings belong to another player.
      if (typed.current !== user) {
        setFetchNote(null);
        return;
      }
      setForm((f) => withFetched(f, ratings));
      const found = COACH_SPEEDS.some((s) => ratings[s] !== null);
      setFetchNote(found ? 'Ratings filled in. Boxes you had already filled were left alone.' : 'That player has no ratings in these speeds yet.');
    } catch (e) {
      if (alive.current) setFetchNote(message(e));
    } finally {
      if (alive.current) setFetching(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const r = planFromForm(form);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const failed = await onSubmit(r.plan);
      if (alive.current && failed) setError(failed);
    } catch (err) {
      if (alive.current) setError(message(err));
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <label htmlFor={`${id}-user`} className="mb-1 block text-sm font-semibold text-ink-300">
          chess.com username (optional)
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={`${id}-user`}
            className={`${inputClass} min-w-0 flex-1 basis-48`}
            value={form.username}
            maxLength={30}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <Button type="button" variant="secondary" size="sm" disabled={fetching} onClick={() => void fetchRatings()}>
            {fetching ? 'Fetching' : 'Fetch my ratings'}
          </Button>
        </div>
        <p className="mt-1 text-sm text-ink-400">With a username the Coach counts your bullet and blitz games and saves your rating once a day. Only the username is sent to chess.com.</p>
        {fetchNote && (
          <p className="mt-1 text-sm text-ember-300" role="status">
            {fetchNote}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${id}-start`} className="mb-1 block text-sm font-semibold text-ink-300">
          Start date
        </label>
        <input id={`${id}-start`} type="date" className={`${inputClass} max-w-48`} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-ink-300">Ratings today</legend>
        <p className="mb-2 text-sm text-ink-400">Leave a box empty to skip that speed.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COACH_SPEEDS.map((s) => (
            <div key={s}>
              <label htmlFor={`${id}-b-${s}`} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-400">
                {SPEED_LABEL[s]}
              </label>
              <input
                id={`${id}-b-${s}`}
                className={`${inputClass} min-w-0`}
                inputMode="numeric"
                maxLength={4}
                value={form.baselines[s]}
                onChange={(e) => setForm(withBaseline(form, s, e.target.value))}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-ink-300">Targets</legend>
        <p className="mb-2 text-sm text-ink-400">Suggested from your ratings. Change any of them and the rest stay as you set them.</p>
        <div className="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-x-3 gap-y-2" role="group" aria-label="Targets by speed">
          <span />
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">3 months</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">6 months</span>
          {COACH_SPEEDS.map((s) => (
            <TargetRow key={s} speed={s} form={form} onChange={setForm} />
          ))}
        </div>
      </fieldset>

      <p className="text-sm text-ink-400">{note ?? 'Starting turns on "Review it yourself first" for slow games. Everything stays in this browser.'}</p>
      {error && (
        <p className="text-sm font-semibold text-bad-400" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={saving} className="max-sm:w-full">
        {saving ? 'Saving' : submitLabel}
      </Button>
    </form>
  );
}

function TargetRow({ speed, form, onChange }: { speed: (typeof COACH_SPEEDS)[number]; form: FormState; onChange: (f: FormState) => void }) {
  return (
    <>
      <span className="text-sm font-semibold">{SPEED_LABEL[speed]}</span>
      {(['three', 'six'] as const).map((k) => (
        <input
          key={k}
          className={`${inputClass} min-w-0`}
          inputMode="numeric"
          maxLength={4}
          aria-label={`${SPEED_LABEL[speed]} target after ${k === 'three' ? '3' : '6'} months`}
          value={form.targets[speed][k]}
          onChange={(e) => onChange(withTarget(form, speed, k, e.target.value))}
        />
      ))}
    </>
  );
}

