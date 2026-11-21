import { describe, expect, it } from 'vitest';
import { INITIAL_INSTALL_STATE, installReducer, installView, isIosSafari, type InstallPromptEvent } from './installLogic.ts';

const fakeEvent = { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' as const }) } as unknown as InstallPromptEvent;

describe('installReducer', () => {
  it('stores the deferred prompt and clears it once used', () => {
    const a = installReducer(INITIAL_INSTALL_STATE, { type: 'prompt-available', event: fakeEvent });
    expect(a.deferred).toBe(fakeEvent);
    expect(installReducer(a, { type: 'prompt-used' }).deferred).toBeNull();
  });

  it('marks installed and drops the prompt', () => {
    const a = installReducer(INITIAL_INSTALL_STATE, { type: 'prompt-available', event: fakeEvent });
    expect(installReducer(a, { type: 'installed' })).toEqual({ deferred: null, installed: true });
  });

  it('ignores a prompt once installed', () => {
    const s = installReducer(INITIAL_INSTALL_STATE, { type: 'standalone', value: true });
    expect(installReducer(s, { type: 'prompt-available', event: fakeEvent }).deferred).toBeNull();
  });

  it('tracks standalone display mode changes', () => {
    const on = installReducer(INITIAL_INSTALL_STATE, { type: 'standalone', value: true });
    expect(on.installed).toBe(true);
    expect(installReducer(on, { type: 'standalone', value: false }).installed).toBe(false);
  });
});

describe('isIosSafari', () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const chromeIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
  const ipadOs = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

  it('detects iPhone Safari', () => expect(isIosSafari(safari)).toBe(true));
  it('rejects Chrome on iOS and Android', () => {
    expect(isIosSafari(chromeIos)).toBe(false);
    expect(isIosSafari(android)).toBe(false);
  });
  it('detects iPadOS desktop-mode Safari by touch points only', () => {
    expect(isIosSafari(ipadOs, 5)).toBe(true);
    expect(isIosSafari(ipadOs, 0)).toBe(false);
  });
});

describe('installView', () => {
  it('prefers installed, then prompt, then the iOS hint', () => {
    const withPrompt = installReducer(INITIAL_INSTALL_STATE, { type: 'prompt-available', event: fakeEvent });
    expect(installView({ deferred: null, installed: true }, true)).toBe('installed');
    expect(installView(withPrompt, true)).toBe('prompt');
    expect(installView(INITIAL_INSTALL_STATE, true)).toBe('ios-hint');
    expect(installView(INITIAL_INSTALL_STATE, false)).toBe('none');
  });
});
