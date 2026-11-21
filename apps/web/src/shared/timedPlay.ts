import { useSyncExternalStore } from 'react';

/**
 * "A timed run is in progress" signal (Puzzle Rush). Anything that must not interrupt timed play, such as a
 * friend invitation card, reads it. Counted, so overlapping holders (StrictMode remounts) cannot get it stuck.
 */

let holders = 0;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((fn) => fn());

/** Mark timed play as active; call the returned function once to release it (extra calls are ignored). */
export function beginTimedPlay(): () => void {
  holders++;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    notify();
  };
}

export const isTimedPlayActive = (): boolean => holders > 0;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useTimedPlay(): boolean {
  return useSyncExternalStore(subscribe, isTimedPlayActive, isTimedPlayActive);
}
