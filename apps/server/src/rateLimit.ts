/** Per-socket message rate limit: pure counting, so it can be tested without a socket. */

export const BURST_WINDOW_MS = 1000;
export const BURST_LIMIT = 40;
export const SUSTAINED_WINDOW_MS = 10_000;
export const SUSTAINED_LIMIT = 200;

export type RateVerdict = 'ok' | 'drop' | 'close';

/**
 * Counts one socket's messages in two fixed windows. More than BURST_LIMIT in a second: the excess is dropped
 * (`firstDrop` is true only the first time, so the caller logs once). More than SUSTAINED_LIMIT in ten seconds:
 * the socket should be closed.
 */
export class MessageRateLimiter {
  private burstStart = -Infinity;
  private burst = 0;
  private longStart = -Infinity;
  private long = 0;
  private warned = false;

  hit(now: number): { verdict: RateVerdict; firstDrop: boolean } {
    if (now - this.burstStart >= BURST_WINDOW_MS) {
      this.burstStart = now;
      this.burst = 0;
    }
    if (now - this.longStart >= SUSTAINED_WINDOW_MS) {
      this.longStart = now;
      this.long = 0;
    }
    this.burst++;
    this.long++;
    if (this.long > SUSTAINED_LIMIT) return { verdict: 'close', firstDrop: false };
    if (this.burst > BURST_LIMIT) {
      const firstDrop = !this.warned;
      this.warned = true;
      return { verdict: 'drop', firstDrop };
    }
    return { verdict: 'ok', firstDrop: false };
  }
}
