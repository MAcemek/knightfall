/**
 * Wrap a callback that runs from a timer so that one throwing room (or club, bot, series) cannot take the
 * whole server down: the error is logged and the callback's caller carries on.
 */
export function guard<A extends unknown[]>(label: string, fn: (...args: A) => void, log: (line: string) => void = console.error): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      log(`[battle] ${label} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    }
  };
}
