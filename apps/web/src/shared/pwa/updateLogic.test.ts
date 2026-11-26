import { describe, expect, it } from 'vitest';
import {
  RELOAD_GUARD_MS,
  RELOAD_GUARD_KEY,
  canReloadNow,
  claimReload,
  decideOnUpdate,
  handlePreloadError,
  isTypingTarget,
  onControllerChange,
  shouldCheckOnVisible,
  shouldReloadOnReturn,
  type KeyValueStorage,
} from './updateLogic.ts';

function memoryStorage(): KeyValueStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('canReloadNow', () => {
  it('allows calm pages', () => {
    for (const p of ['/', '/stats', '/settings', '/train', '/train/woodpecker', '/train/endgames', '/train/openings', '/train/vision', '/custom', '/analysis', '/analysis/insights', '/coach', '/coach/week', '/coach/library/more']) {
      expect(canReloadNow(p), p).toBe(true);
    }
  });

  it('treats sessions, battles and drills as busy', () => {
    for (const p of [
      '/play',
      '/battle',
      '/rush',
      '/daily',
      '/puzzles',
      '/train/theme/fork',
      '/train/review',
      '/train/weak',
      '/train/games/play',
      '/train/woodpecker/abc/play',
      '/train/blunder-check/play',
      '/train/endgames/lucena',
      '/custom/play',
      '/custom/play/xyz',
      '/analysis/some-game-key',
      '/coach/daily',
      '/coach/daily/',
      '/coach/daily/today',
    ]) {
      expect(canReloadNow(p), p).toBe(false);
    }
  });

  it('ignores trailing slashes, query strings, hashes and case', () => {
    expect(canReloadNow('/stats/')).toBe(true);
    expect(canReloadNow('/stats?tab=1')).toBe(true);
    expect(canReloadNow('/settings#top')).toBe(true);
    expect(canReloadNow('/Train/')).toBe(true);
    expect(canReloadNow('/?x=1')).toBe(true);
    expect(canReloadNow('/play/')).toBe(false);
    expect(canReloadNow('/play?x=1')).toBe(false);
    expect(canReloadNow('/coach/daily/?x=1')).toBe(false);
    expect(canReloadNow('/coachx')).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it('is true for inputs, textareas, selects and contenteditable', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
  it('is false for other elements and nothing', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
  });
});

describe('onControllerChange', () => {
  it('does not count the first install on a fresh visit as an update', () => {
    expect(onControllerChange(false)).toEqual({ isUpdate: false, hadController: true });
  });
  it('counts a later change as an update', () => {
    expect(onControllerChange(true)).toEqual({ isUpdate: true, hadController: true });
    const first = onControllerChange(false);
    expect(onControllerChange(first.hadController).isUpdate).toBe(true);
  });
});

describe('claimReload', () => {
  it('allows one reload and blocks a second right after', () => {
    const s = memoryStorage();
    expect(claimReload(s, 1000)).toBe(true);
    expect(claimReload(s, 1000 + 5000)).toBe(false);
  });
  it('allows again after the guard window', () => {
    const s = memoryStorage();
    expect(claimReload(s, 1000)).toBe(true);
    expect(claimReload(s, 1000 + RELOAD_GUARD_MS + 1)).toBe(true);
  });
  it('ignores a garbage stored value', () => {
    const s = memoryStorage();
    s.data[RELOAD_GUARD_KEY] = 'nope';
    expect(claimReload(s, 5000)).toBe(true);
  });
  it('blocks the reload when storage throws, so a loop is impossible', () => {
    const bad: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(claimReload(bad, 1000)).toBe(false);
    expect(claimReload(null, 1000)).toBe(false);
  });
});

describe('decideOnUpdate', () => {
  it('reloads at once on a calm page with nothing focused', () => {
    expect(decideOnUpdate('/stats', false)).toBe('reload');
  });
  it('defers on a busy page or while typing', () => {
    expect(decideOnUpdate('/rush', false)).toBe('defer');
    expect(decideOnUpdate('/stats', true)).toBe('defer');
  });
  it('defers on every page while a game review is running', () => {
    expect(decideOnUpdate('/coach', false, true)).toBe('defer');
    expect(decideOnUpdate('/analysis', false, true)).toBe('defer');
    expect(shouldReloadOnReturn(90_000, '/stats', false, true)).toBe(false);
  });
});

describe('handlePreloadError', () => {
  const store = (): KeyValueStorage & { value: string | null } => ({
    value: null,
    getItem() {
      return this.value;
    },
    setItem(_k, v) {
      this.value = v;
    },
  });
  it('reloads once through the guard and keeps the error away', () => {
    const s = store();
    let reloads = 0;
    let prevented = 0;
    const event = { preventDefault: () => prevented++ };
    expect(handlePreloadError(event, s, 1000, () => reloads++)).toBe(true);
    expect(handlePreloadError(event, s, 1000 + 30_000, () => reloads++)).toBe(false);
    expect({ reloads, prevented }).toEqual({ reloads: 1, prevented: 1 });
  });
  it('lets the error through without storage', () => {
    let reloads = 0;
    expect(handlePreloadError({ preventDefault: () => {} }, null, 1000, () => reloads++)).toBe(false);
    expect(reloads).toBe(0);
  });
});

describe('shouldReloadOnReturn', () => {
  it('needs more than 60 seconds hidden, a calm page and no typing', () => {
    expect(shouldReloadOnReturn(61_000, '/stats', false)).toBe(true);
    expect(shouldReloadOnReturn(60_000, '/stats', false)).toBe(false);
    expect(shouldReloadOnReturn(90_000, '/rush', false)).toBe(false);
    expect(shouldReloadOnReturn(90_000, '/stats', true)).toBe(false);
  });
});

describe('shouldCheckOnVisible', () => {
  it('checks only when the last check was over 5 minutes ago', () => {
    expect(shouldCheckOnVisible(10 * 60_000, 4 * 60_000)).toBe(true);
    expect(shouldCheckOnVisible(5 * 60_000 + 1, 0)).toBe(true);
    expect(shouldCheckOnVisible(5 * 60_000, 0)).toBe(false);
    expect(shouldCheckOnVisible(60_000, 30_000)).toBe(false);
  });
});
