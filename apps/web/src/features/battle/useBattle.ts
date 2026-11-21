import { useEffect } from 'react';
import { REMATCH_WINDOW_MS, type BattleState } from './battleState.ts';
import { serverNow, wakeBattleServer } from '../../shared/battle/connection.ts';
import {
  backToLobby, cancelSearch, claim, clearError, expireRematch, findOpponent, goPlaying, initBattleStore, leaveBattlePage, rematch,
  reportResult, resign, useBattleState,
} from '../../shared/battle/store.ts';

export interface BattleApi {
  state: BattleState;
  /** Current server time estimate (epoch ms). */
  serverNow: () => number;
  findOpponent: () => void;
  cancel: () => void;
  reportResult: (puzzle: { id: string; rating: number }, solved: boolean) => void;
  rematch: () => void;
  resign: () => void;
  /** Claim the win early (vs a struck-out bot while ahead). */
  claim: () => void;
  backToLobby: () => void;
  clearError: () => void;
}

const api = { serverNow, findOpponent, cancel: cancelSearch, reportResult, rematch, resign, claim, backToLobby, clearError };

/** Pages currently showing the Battle UI (more than one while React StrictMode double-mounts in dev). */
let mounted = 0;

/**
 * Thin hook over the battle store (shared/battle/store.ts), which is fed by the app-wide socket. The page owns
 * only the timers that move the UI along; leaving the page abandons a live battle, as before.
 */
export function useBattle(): BattleApi {
  const state = useBattleState();

  // Opening the Battle page makes sure the store is listening and starts waking a sleeping hosted server.
  useEffect(() => {
    initBattleStore();
    wakeBattleServer();
  }, []);

  // Countdown finished -> playing.
  const startsAt = state.match?.startsAt ?? 0;
  useEffect(() => {
    if (state.phase !== 'matched' || !startsAt) return;
    const t = setTimeout(goPlaying, Math.max(0, startsAt - serverNow()));
    return () => clearTimeout(t);
  }, [state.phase, startsAt]);

  // Rematch offers expire with the server's window.
  const endedAt = state.end?.endedAt ?? 0;
  useEffect(() => {
    if (state.phase !== 'ended' || !endedAt) return;
    const t = setTimeout(expireRematch, Math.max(0, endedAt + REMATCH_WINDOW_MS - Date.now()));
    return () => clearTimeout(t);
  }, [state.phase, endedAt]);

  // Leaving the page: abandoning a live battle counts as a loss; the socket itself stays open. Deferred one
  // tick so StrictMode's mount/unmount/mount cycle does not resign a battle that was waiting for this page.
  useEffect(() => {
    mounted++;
    return () => {
      mounted--;
      setTimeout(() => {
        if (mounted === 0) leaveBattlePage();
      }, 0);
    };
  }, []);

  return { state, ...api };
}
