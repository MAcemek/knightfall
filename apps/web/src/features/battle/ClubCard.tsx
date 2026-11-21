import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Icons, Panel } from '../../shared/ui.tsx';
import { codeProblem, formatCodeInput } from '../../shared/battle/challengeLogic.ts';
import { createClub, dismissClubError, joinClub, useClub } from '../../shared/battle/clubStore.ts';
import type { FriendPrefs } from './friendSettings.ts';
import { SettingsControls } from './SettingsControls.tsx';
import type { PrefsPatch } from './useFriendPrefs.ts';

/** "Club room" card in the Lobby: open a room (host picks time and difficulty) or join one by code. */
export function ClubCard({ prefs, onPrefs }: { prefs: FriendPrefs; onPrefs: (patch: PrefsPatch) => void }) {
  const club = useClub();
  const [params] = useSearchParams();
  // `/battle?club=CODE` prefills the box; the player still presses Join.
  const [input, setInput] = useState(() => formatCodeInput(params.get('club') ?? ''));
  const problem = codeProblem(input);
  const busy = club.pending !== null;

  return (
    <Panel>
      <h2 className="text-sm font-bold uppercase tracking-wider text-ink-400">Club room</h2>
      <p className="mt-1 text-sm text-ink-300">Everyone races the same puzzles at once, with a live ranking.</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-400">Host a room</div>
          <SettingsControls prefs={prefs} onChange={onPrefs} withSeries={false} />
          <Button className="mt-2 min-h-11" variant="primary" disabled={busy} onClick={() => void createClub(prefs.settings)}>
            {Icons.swords('h-4 w-4')} {club.pending === 'create' ? 'Creating…' : 'Create room'}
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem && !busy) void joinClub(input);
          }}
        >
          <label htmlFor="club-code" className="mb-1.5 block text-xs font-semibold text-ink-400">
            Join with a code
          </label>
          <div className="flex gap-2">
            <input
              id="club-code"
              value={input}
              onChange={(e) => setInput(formatCodeInput(e.target.value))}
              placeholder="ABC-123"
              maxLength={7}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 w-0 min-w-0 flex-1 rounded-xl border border-ink-600 bg-ink-800 px-3 font-mono text-lg font-bold uppercase tracking-widest text-ink-100 placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-ember-400"
            />
            <Button type="submit" variant="secondary" disabled={!!problem || busy}>
              {club.pending === 'join' ? 'Joining…' : 'Join'}
            </Button>
          </div>
        </form>
      </div>
      {club.error && (
        <div className="mt-3 flex animate-pop items-center justify-between gap-3 rounded-xl border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm font-semibold text-bad-400" role="alert">
          <span>{club.error}</span>
          <button className="flex h-8 w-8 shrink-0 items-center justify-center text-ink-300 hover:text-ink-100" onClick={dismissClubError} aria-label="Dismiss">
            {Icons.x('h-4 w-4')}
          </button>
        </div>
      )}
    </Panel>
  );
}
