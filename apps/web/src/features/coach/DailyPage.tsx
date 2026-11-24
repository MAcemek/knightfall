import { useState } from 'react';
import { Button, EmptyState, Icons, Modal } from '../../shared/ui.tsx';
import { NoteCard } from './NoteCard.tsx';
import { canAddNote, MAX_DAILY_NOTES } from './notesLogic.ts';
import { addDailyNote, removeDailyNote, useDailyNotes } from './notesStore.ts';

/** /coach/daily: a short checklist for each Daily game in progress. No board, no engine, no database. */

export function DailyPage() {
  const notes = useDailyNotes();
  const [asking, setAsking] = useState<string | null>(null);
  if (!notes) {
    return (
      <p className="text-sm text-ink-400" role="status">
        Loading your games.
      </p>
    );
  }
  const asked = notes.find((n) => n.id === asking);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-300">
        Before every move in a Daily game, look for their checks, captures and threats, and write down what you find. This page has no board, no engine and no opening database on purpose: Daily games allow no outside help, so the check has to come from you.
      </p>
      <div>
        <Button variant="primary" disabled={!canAddNote(notes)} onClick={() => void addDailyNote()}>
          Add a game
        </Button>
        {!canAddNote(notes) && <p className="mt-2 text-sm text-ink-400">You have {MAX_DAILY_NOTES} games here. Delete one to add another.</p>}
      </div>
      {notes.length === 0 ? (
        <EmptyState icon={Icons.calendar('h-6 w-6')} title="No Daily games yet">
          Add a game for each Daily game you are playing. Up to {MAX_DAILY_NOTES}.
        </EmptyState>
      ) : (
        notes.map((n) => <NoteCard key={n.id} note={n} onAskDelete={() => setAsking(n.id)} />)
      )}
      <Modal open={!!asked} onClose={() => setAsking(null)} label="Delete this game">
        <h2 className="text-lg font-extrabold">Delete this game?</h2>
        <p className="mt-2 text-sm text-ink-300">
          The notes{asked?.opponent ? ` for ${asked.opponent}` : ''} are deleted. This cannot be undone.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="danger"
            onClick={() => {
              const id = asking;
              setAsking(null);
              if (id) void removeDailyNote(id);
            }}
          >
            Delete
          </Button>
          <Button variant="secondary" onClick={() => setAsking(null)}>
            Keep it
          </Button>
        </div>
      </Modal>
    </div>
  );
}
