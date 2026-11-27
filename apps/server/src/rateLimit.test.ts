import { describe, expect, it } from 'vitest';
import { BURST_LIMIT, BURST_WINDOW_MS, MessageRateLimiter, SUSTAINED_LIMIT, SUSTAINED_WINDOW_MS } from './rateLimit.ts';

describe('MessageRateLimiter', () => {
  it('lets a normal pace through', () => {
    const l = new MessageRateLimiter();
    for (let i = 0; i < 100; i++) expect(l.hit(i * 500).verdict).toBe('ok');
  });

  it('drops the excess of a burst and reports the first drop only once', () => {
    const l = new MessageRateLimiter();
    for (let i = 0; i < BURST_LIMIT; i++) expect(l.hit(1000).verdict).toBe('ok');
    expect(l.hit(1000)).toEqual({ verdict: 'drop', firstDrop: true });
    expect(l.hit(1000)).toEqual({ verdict: 'drop', firstDrop: false });
  });

  it('accepts messages again in the next second', () => {
    const l = new MessageRateLimiter();
    for (let i = 0; i <= BURST_LIMIT; i++) l.hit(1000);
    expect(l.hit(1000 + BURST_WINDOW_MS).verdict).toBe('ok');
  });

  it('keeps logging off for a second burst of the same socket', () => {
    const l = new MessageRateLimiter();
    for (let i = 0; i <= BURST_LIMIT; i++) l.hit(0);
    for (let i = 0; i < BURST_LIMIT; i++) l.hit(2000);
    expect(l.hit(2000)).toEqual({ verdict: 'drop', firstDrop: false });
  });

  it('asks to close a socket that keeps sending over ten seconds', () => {
    const l = new MessageRateLimiter();
    let verdict = 'ok';
    // 30 a second never trips the burst limit, but 300 in ten seconds is too much.
    for (let i = 0; i <= SUSTAINED_LIMIT; i++) verdict = l.hit(Math.floor(i / 30) * 1000).verdict;
    expect(verdict).toBe('close');
  });

  it('forgets the long window after ten quiet seconds', () => {
    const l = new MessageRateLimiter();
    for (let i = 0; i < SUSTAINED_LIMIT; i++) l.hit(Math.floor(i / 30) * 1000);
    expect(l.hit(SUSTAINED_WINDOW_MS + 1).verdict).toBe('ok');
  });
});
