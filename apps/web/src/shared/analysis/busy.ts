/**
 * Which game reviews are running right now. Kept apart from session.ts on purpose: the update watcher in the main
 * bundle reads it, and it must not pull the engine code in with it.
 */
const running = new Set<string>();

export function setAnalysisRunning(gameKey: string, on: boolean): void {
  if (on) running.add(gameKey);
  else running.delete(gameKey);
}

/** A review is running (it may continue after the user left its page, and nothing is saved until it ends). */
export function isAnalysisRunning(): boolean {
  return running.size > 0;
}
