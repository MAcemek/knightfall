import { useCallback, useEffect, useRef, useState } from 'react';
import { syncCoach, type SyncResult } from './sync.ts';

/** Runs the chess.com sync for the open Coach: once when it opens (syncCoach itself waits 15 minutes between runs) and on demand. */

export interface CoachSync {
  busy: boolean;
  /** An error line from the last run, or a note such as "nothing new". */
  note: string | null;
  failed: boolean;
  run: (manual: boolean) => void;
}

export function noteFor(r: SyncResult): string | null {
  if (r.skipped === 'recent') return 'Already up to date. Try again in a few seconds.';
  if (r.skipped) return null;
  return r.newGames > 0 ? `Added ${r.newGames} ${r.newGames === 1 ? 'game' : 'games'}.` : 'Nothing new.';
}

/** `user` is the plan's username; without one there is nothing to sync. */
export function useCoachSync(user: string): CoachSync {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const runId = useRef(0);
  const latest = useRef<(manual: boolean, again?: boolean) => void>(() => undefined);

  const run = useCallback(
    (manual: boolean, again = false) => {
      if (!user) return;
      const mine = ++runId.current;
      setBusy(true);
      if (manual) {
        setNote(null);
        setFailed(false);
      }
      syncCoach({ force: manual })
        .then((r) => {
          if (!alive.current || mine !== runId.current) return;
          // The run that was joined belonged to the old username: sync the current one once.
          if (r.skipped === 'changed' && !again) {
            latest.current(manual, true);
            return;
          }
          setFailed(false);
          setNote(manual ? noteFor(r) : null);
        })
        .catch((e: unknown) => {
          if (!alive.current || mine !== runId.current) return;
          setFailed(true);
          setNote(e instanceof Error && e.message ? e.message : 'The sync did not work. Try again later.');
        })
        .finally(() => {
          if (alive.current && mine === runId.current) setBusy(false);
        });
    },
    [user],
  );

  latest.current = run;

  useEffect(() => {
    alive.current = true;
    if (user) run(false);
    else {
      runId.current++;
      setBusy(false);
    }
    return () => {
      alive.current = false;
    };
  }, [run, user]);

  return { busy, note, failed, run };
}
