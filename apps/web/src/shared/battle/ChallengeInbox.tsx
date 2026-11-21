import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sfx } from '../fx/index.ts';
import { Button, Icons, Pill } from '../ui.tsx';
import { useTimedPlay } from '../timedPlay.ts';
import { useNow } from '../../features/battle/util.ts';
import { serverNow } from './connection.ts';
import { formatCountdown, inviteDisplay, secondsLeft, topInvite } from './challengeLogic.ts';
import { respondToInvite, useBattleState, useChallenges } from './store.ts';

/**
 * Friend invitation, mounted once in the app shell so it shows on any page. Never shown while a battle is
 * live (the server answers "busy" to challengers then). During a timed Rush run it is only a slim pill that
 * expands to the card on tap. Below the lg breakpoint it sits at the top, under the header, so it never covers
 * the puzzle control dock or the mobile tab bar; on desktop it sits bottom-right.
 */
export function ChallengeInbox() {
  const { incoming } = useChallenges();
  const phase = useBattleState().phase;
  const timedPlay = useTimedPlay();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const live = phase === 'matched' || phase === 'playing';
  const top = topInvite(incoming);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const display = inviteDisplay({ invite: top, battleLive: live, timedPlay, expanded: !!top && expandedId === top.id });
  const invite = display === 'none' ? null : top;
  useNow(250, !!invite);

  // A battle that starts while the player is on another page (an Accept, or a friend accepting while this
  // player wandered off) belongs on the Battle page.
  useEffect(() => {
    if (live && !pathname.startsWith('/battle')) void navigate('/battle');
  }, [live, pathname, navigate]);

  // A soft cue once per invitation, when the full card first appears (silent during a timed run).
  const cued = useRef<string | null>(null);
  const cardId = display === 'card' ? top?.id ?? null : null;
  useEffect(() => {
    if (cardId && cued.current !== cardId) {
      cued.current = cardId;
      sfx.invite();
    }
  }, [cardId]);

  if (!invite) return null;
  const left = secondsLeft(invite.expiresAt, serverNow());
  const more = incoming.length - 1;

  const wrap =
    'pointer-events-none fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-[90] flex justify-center pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] lg:inset-x-auto lg:bottom-6 lg:right-6 lg:top-auto lg:px-0';

  if (display === 'banner') {
    return (
      <div className={wrap}>
        <button
          key={invite.id}
          type="button"
          role="status"
          onClick={() => setExpandedId(invite.id)}
          className="pointer-events-auto flex min-h-11 max-w-full animate-toast-in items-center gap-2 rounded-full border border-ember-500 bg-ink-850 py-1.5 pl-3 pr-4 text-sm font-semibold text-ink-100 shadow-[0_6px_24px_-6px_rgb(0_0_0/0.8)]"
        >
          <span className="shrink-0 text-ember-400">{Icons.swords('h-5 w-5')}</span>
          <span className="min-w-0 truncate">{invite.from.name} challenged you</span>
          <span className="shrink-0 font-mono font-bold text-ember-400" aria-label={`${left} seconds left`}>
            {formatCountdown(left)}
          </span>
          <span className="shrink-0 font-bold text-ember-400 underline">View</span>
        </button>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <div
        key={invite.id}
        role="alert"
        className="pointer-events-auto w-full max-w-sm animate-toast-in rounded-2xl border-2 border-ember-500 bg-ink-850 p-3.5 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.9)]"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ember-500/20 text-ember-400">{Icons.swords('h-6 w-6')}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-extrabold text-ink-100">
              <span className="break-words">{invite.from.name}</span> challenges you to a Puzzle Battle
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-200">
              <Pill className="bg-sky-400/20 text-sky-400">Casual</Pill>
              <span className="font-mono">{invite.from.rating}</span>
              <span className="font-mono font-bold text-ember-400" aria-label={`${left} seconds left`}>
                {formatCountdown(left)}
              </span>
              {more > 0 && <span className="text-ink-300">+{more} more</span>}
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" className="min-h-11" onClick={() => respondToInvite(invite.id, false)}>
            Decline
          </Button>
          <Button
            variant="good"
            className="min-h-11"
            onClick={() => {
              respondToInvite(invite.id, true);
              void navigate('/battle');
            }}
          >
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
