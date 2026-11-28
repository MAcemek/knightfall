import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { normalizeCode } from '@knightfall/core';
import { Button, Icons, Panel } from '../../shared/ui.tsx';
import { serverNow, useConnection } from '../../shared/battle/connection.ts';
import { codeProblem, formatCodeInput, outgoingMessage } from '../../shared/battle/challengeLogic.ts';
import { dismissClubError, getClubState, joinClub, useClub } from '../../shared/battle/clubStore.ts';
import { cancelChallenge, dismissChallengeResult, sendChallenge, useChallenges } from '../../shared/battle/store.ts';
import type { FriendPrefs } from './friendSettings.ts';
import { useFriendPrefs } from './useFriendPrefs.ts';
import { useNow } from './util.ts';

const INPUT_CLASS =
  'h-11 w-full rounded-xl border border-ink-600 bg-ink-800 px-3 font-mono text-lg font-bold uppercase tracking-widest text-ink-100 placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-ember-400';

/**
 * "Have a code?": one box for a room code or a friend's code. The two look the same, so the person picks
 * what the code is with the button instead of the app guessing.
 * `prefs` lets the Lobby pass its live friend-battle options (a second useFriendPrefs copy would go stale).
 * `bare` drops the card frame and title, for use inside another card (Home's Battle card).
 */
export function CodeCard({ onDone, prefs: given, bare = false }: { onDone?: () => void; prefs?: FriendPrefs; bare?: boolean }) {
  const connection = useConnection();
  const club = useClub();
  const { outgoing } = useChallenges();
  const [params] = useSearchParams();
  const [ownPrefs] = useFriendPrefs();
  const prefs = given ?? ownPrefs;
  // `/battle?club=CODE` or `?challenge=CODE` prefills the box; the player still presses the button.
  const [input, setInput] = useState(() => formatCodeInput(params.get('club') ?? params.get('challenge') ?? ''));
  const challengePrimary = !params.get('club') && !!params.get('challenge');
  useNow(250, outgoing.kind === 'waiting');

  const problem = codeProblem(input);
  const typed = normalizeCode(input).length;
  const message = outgoingMessage(outgoing, serverNow());
  const challenging = outgoing.kind === 'waiting' || outgoing.kind === 'sending';
  const joinBusy = club.pending !== null || challenging;
  const challengeBusy = challenging || club.pending !== null || connection.moved;

  const join = async () => {
    if (problem || joinBusy) return;
    await joinClub(input);
    if (!getClubState().error) onDone?.();
  };
  const challenge = () => {
    if (problem || challengeBusy) return;
    sendChallenge(input, prefs.settings, prefs.series);
    onDone?.();
  };

  const Frame = bare ? 'div' : Panel;
  return (
    <Frame>
      {!bare && <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-ink-400">Have a code?</h2>}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (challengePrimary) challenge();
          else void join();
        }}
      >
        <label htmlFor="battle-code" className="text-xs font-semibold text-ink-400">
          Enter a code
        </label>
        <input
          id="battle-code"
          value={input}
          onChange={(e) => {
            setInput(formatCodeInput(e.target.value));
            dismissChallengeResult();
          }}
          placeholder="ABC-123"
          maxLength={7}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={typed === 6 && !!problem}
          className={INPUT_CLASS}
        />
        <p className="text-xs text-ink-400">A room code from your club, or a friend's code.</p>
        {typed === 6 && problem && <p className="text-xs text-bad-400">{problem}</p>}
        {challenging ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-100">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-ember-400 border-t-transparent" aria-hidden />
              <span className="min-w-0 break-words">{message?.text}</span>
            </div>
            <Button size="sm" variant="secondary" className="min-h-11 self-start" onClick={cancelChallenge}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              type={challengePrimary ? 'button' : 'submit'}
              variant={challengePrimary ? 'secondary' : 'primary'}
              className="min-h-11 flex-1"
              disabled={!!problem || joinBusy}
              onClick={challengePrimary ? () => void join() : undefined}
            >
              {club.pending === 'join' ? 'Joining…' : 'Join room'}
            </Button>
            <Button
              type={challengePrimary ? 'submit' : 'button'}
              variant={challengePrimary ? 'primary' : 'secondary'}
              className="min-h-11 flex-1"
              disabled={!!problem || challengeBusy}
              onClick={challengePrimary ? undefined : challenge}
            >
              Challenge
            </Button>
          </div>
        )}
      </form>
      {outgoing.kind === 'result' && message && (
        <div className="mt-3 flex animate-feedback-in items-center justify-between gap-3 rounded-xl border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm font-semibold text-bad-400" role="alert">
          <span>{message.text}</span>
          <button className="-my-1 flex h-10 w-10 shrink-0 items-center justify-center text-ink-300 hover:text-ink-100" onClick={dismissChallengeResult} aria-label="Dismiss">
            {Icons.x('h-4 w-4')}
          </button>
        </div>
      )}
      {club.error && (
        <div className="mt-3 flex animate-feedback-in items-center justify-between gap-3 rounded-xl border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm font-semibold text-bad-400" role="alert">
          <span>{club.error}</span>
          <button className="-my-1 flex h-10 w-10 shrink-0 items-center justify-center text-ink-300 hover:text-ink-100" onClick={dismissClubError} aria-label="Dismiss">
            {Icons.x('h-4 w-4')}
          </button>
        </div>
      )}
    </Frame>
  );
}
