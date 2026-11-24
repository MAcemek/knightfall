import { useEffect, useId, useRef, useState } from 'react';
import { Button, Panel, Segmented } from '../../shared/ui.tsx';
import { inputClass } from '../woodpecker/parts.tsx';
import { MAX_OPPONENT, MAX_TEXT, type DailyNote, type NoteLook, type NotePatch, type NoteText } from './notesLogic.ts';
import { updateDailyNote } from './notesStore.ts';

/** One Daily game: opponent, colour, three looks with a note each, candidates and a plan. Text is saved a moment after typing. */

const SAVE_DELAY_MS = 600;

const LOOKS: { id: NoteLook; title: string; help: string }[] = [
  { id: 'checks', title: 'Their checks', help: 'Every check they could give.' },
  { id: 'captures', title: 'Their captures', help: 'Anything they can take, and what hangs.' },
  { id: 'threats', title: 'Their threats', help: 'What they want to do next move.' },
];

const COLORS = [
  { id: 'w', label: 'White' },
  { id: 'b', label: 'Black' },
] as const;

type Texts = Record<NoteText, string>;

const textsOf = (n: DailyNote): Texts => ({ opponent: n.opponent, checks: n.checks, captures: n.captures, threats: n.threats, candidates: n.candidates, plan: n.plan });

export function NoteCard({ note, onAskDelete }: { note: DailyNote; onAskDelete: () => void }) {
  const [texts, setTexts] = useState<Texts>(() => textsOf(note));
  const pending = useRef<NotePatch>({});
  const timer = useRef<number | null>(null);
  const id = useId();
  const noteId = note.id;

  const flush = useRef(() => {});
  flush.current = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) void updateDailyNote(noteId, patch);
  };

  useEffect(() => {
    const run = () => flush.current();
    window.addEventListener('pagehide', run);
    return () => {
      window.removeEventListener('pagehide', run);
      run();
    };
  }, []);

  const type = (field: NoteText, value: string) => {
    setTexts((t) => ({ ...t, [field]: value }));
    pending.current = { ...pending.current, [field]: value };
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush.current(), SAVE_DELAY_MS);
  };

  const look = (k: NoteLook) => {
    flush.current();
    void updateDailyNote(noteId, { done: { [k]: !note.done[k] } });
  };

  const reset = () => {
    // Drop what was typed but not saved yet for the three looks, so it cannot come back after the reset.
    const { checks: _c, captures: _p, threats: _t, ...rest } = pending.current;
    pending.current = rest;
    setTexts((t) => ({ ...t, checks: '', captures: '', threats: '' }));
    void updateDailyNote(noteId, { checks: '', captures: '', threats: '', done: { checks: false, captures: false, threats: false } });
  };

  const askDelete = () => {
    flush.current();
    onAskDelete();
  };

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-40">
          <label htmlFor={`${id}-opp`} className="mb-1 block text-sm font-semibold text-ink-300">
            Opponent
          </label>
          <input id={`${id}-opp`} className={inputClass} value={texts.opponent} maxLength={MAX_OPPONENT} autoComplete="off" onChange={(e) => type('opponent', e.target.value)} />
        </div>
        <div>
          <Segmented
            options={COLORS}
            value={note.myColor}
            label="Your colour"
            onChange={(c) => {
              flush.current();
              void updateDailyNote(noteId, { myColor: c });
            }}
          />
        </div>
      </div>

      {LOOKS.map((l) => (
        <div key={l.id}>
          <div className="flex items-start gap-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={note.done[l.id]}
              aria-label={`${l.title}, looked`}
              onClick={() => look(l.id)}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 text-sm font-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${note.done[l.id] ? 'border-good-500 bg-good-500 text-ink-950' : 'border-ink-600 text-transparent'}`}
            >
              ✓
            </button>
            <label htmlFor={`${id}-${l.id}`} className="min-w-0 flex-1 pt-2.5 text-sm">
              <span className="font-semibold">{l.title}</span> <span className="text-ink-400">{l.help}</span>
            </label>
          </div>
          <textarea id={`${id}-${l.id}`} className={`${inputClass} mt-1 resize-y`} rows={2} maxLength={MAX_TEXT} value={texts[l.id]} onChange={(e) => type(l.id, e.target.value)} />
        </div>
      ))}

      <div>
        <label htmlFor={`${id}-cand`} className="mb-1 block text-sm font-semibold text-ink-300">
          Candidate moves
        </label>
        <textarea id={`${id}-cand`} className={`${inputClass} resize-y`} rows={2} maxLength={MAX_TEXT} value={texts.candidates} onChange={(e) => type('candidates', e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${id}-plan`} className="mb-1 block text-sm font-semibold text-ink-300">
          My plan
        </label>
        <textarea id={`${id}-plan`} className={`${inputClass} resize-y`} rows={2} maxLength={MAX_TEXT} value={texts.plan} onChange={(e) => type('plan', e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={reset}>
          New move: reset the check
        </Button>
        <Button size="sm" variant="ghost" onClick={askDelete}>
          Delete this game
        </Button>
      </div>
    </Panel>
  );
}
