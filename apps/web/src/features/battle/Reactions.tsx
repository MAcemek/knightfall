import { useEffect, useState } from 'react';
import { REACTIONS, REACTION_COOLDOWN_MS, REACTION_EMOJI, REACTION_LABEL } from '@knightfall/core';
import { useConnection } from '../../shared/battle/connection.ts';
import { serverSupports } from '../../shared/battle/connectionLogic.ts';
import { sendReaction, useLastSentAt, useReactions } from '../../shared/battle/reactions.ts';

/** Five quick reactions plus floating bubbles for the ones that arrive (and mine, so a tap feels answered). */
export function Reactions() {
  const { serverCaps } = useConnection();
  const items = useReactions();
  const lastSentAt = useLastSentAt();
  const [cooling, setCooling] = useState(false);

  useEffect(() => {
    if (lastSentAt === null) return;
    const left = lastSentAt + REACTION_COOLDOWN_MS - Date.now();
    if (left <= 0) return;
    setCooling(true);
    const t = setTimeout(() => setCooling(false), left);
    return () => clearTimeout(t);
  }, [lastSentAt]);

  if (!serverSupports(serverCaps, 'react')) return null;

  return (
    <div className="mt-4 w-full sm:mt-5">
      <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Quick reactions">
        {REACTIONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-label={`Send ${REACTION_LABEL[r]}`}
            disabled={cooling}
            onClick={() => sendReaction(r)}
            className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-full bg-ink-800 px-3 text-lg transition hover:bg-ink-700 active:scale-95 disabled:opacity-50"
          >
            <span aria-hidden>{REACTION_EMOJI[r]}</span>
            {r === 'gg' && <span className="text-sm font-bold text-ink-100">GG</span>}
          </button>
        ))}
      </div>
      <div className="mt-1 h-4 text-center text-xs font-semibold text-ink-400" aria-hidden>
        {cooling ? 'Sent' : ''}
      </div>
      <div className="flex min-h-9 flex-col items-center gap-1" aria-live="polite" data-testid="reaction-bubbles">
        {items.map((it) => (
          <div
            key={it.id}
            data-testid="reaction-bubble"
            className="animate-rise rounded-full bg-ink-700 px-3 py-1 text-sm font-semibold text-ink-100 shadow-lg shadow-black/30"
          >
            {it.from ?? 'You'}: {REACTION_EMOJI[it.reaction]} <span className="sr-only">{REACTION_LABEL[it.reaction]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
