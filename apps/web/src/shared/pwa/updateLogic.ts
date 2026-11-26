/**
 * Rules for switching an open page to a freshly deployed version without breaking what the user is doing.
 * Pure on purpose: no DOM, no service worker, so every rule is unit-tested.
 */

export const CHECK_EVERY_MS = 30 * 60_000;
export const VISIBLE_CHECK_AFTER_MS = 5 * 60_000;
export const HIDDEN_RELOAD_AFTER_MS = 60_000;
/** A second reload inside this window is refused, so a loop is impossible. */
export const RELOAD_GUARD_MS = 2 * 60_000;
export const RELOAD_GUARD_KEY = 'kf-update-reloaded';

const CALM_EXACT = new Set([
  '/',
  '/stats',
  '/settings',
  '/train',
  '/train/woodpecker',
  '/train/endgames',
  '/train/openings',
  '/train/vision',
  '/custom',
  '/analysis',
  '/analysis/insights',
  '/coach',
]);

/** Lower-case path without query, hash or trailing slashes ('/' stays '/'). */
function normalizePath(pathname: string): string {
  const bare = (pathname.split(/[?#]/, 1)[0] ?? '').toLowerCase();
  const trimmed = bare.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** True only on pages where nothing is in progress, so a reload costs the user nothing. */
export function canReloadNow(pathname: string): boolean {
  const p = normalizePath(pathname);
  if (CALM_EXACT.has(p)) return true;
  if (p.startsWith('/coach/')) return p !== '/coach/daily' && !p.startsWith('/coach/daily/');
  return false;
}

export interface FocusLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** True when the focused element is something the user types or picks in. */
export function isTypingTarget(el: FocusLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * A controller change is an update only when the page already had a controller. The first install on a
 * fresh visit takes control too, and that is not an update. After any change the page has a controller.
 */
export function onControllerChange(hadController: boolean): { isUpdate: boolean; hadController: true } {
  return { isUpdate: hadController, hadController: true };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Returns true once per window. If storage is unavailable it refuses, which is the safe side. */
export function claimReload(storage: KeyValueStorage | null, now: number): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_GUARD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_MS) return false;
    storage.setItem(RELOAD_GUARD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/**
 * What to do the moment an update is ready. A running game review counts as busy on every page: it goes on
 * after the user leaves its page, and a reload would throw it away.
 */
export function decideOnUpdate(pathname: string, typing: boolean, analysing = false): 'reload' | 'defer' {
  return canReloadNow(pathname) && !typing && !analysing ? 'reload' : 'defer';
}

/** Coming back to a tab that was hidden for a while. */
export function shouldReloadOnReturn(hiddenMs: number, pathname: string, typing: boolean, analysing = false): boolean {
  return hiddenMs > HIDDEN_RELOAD_AFTER_MS && decideOnUpdate(pathname, typing, analysing) === 'reload';
}

/**
 * A page chunk of the old build is gone after a deploy: reload once to get the new build. Returns false, and leaves
 * the error alone, when the reload guard refuses (a second reload inside two minutes, or no storage).
 */
export function handlePreloadError(event: { preventDefault(): void }, storage: KeyValueStorage | null, now: number, reload: () => void): boolean {
  if (!claimReload(storage, now)) return false;
  event.preventDefault();
  reload();
  return true;
}

/** Whether coming back to the tab should trigger a fresh update check. */
export function shouldCheckOnVisible(now: number, lastCheck: number): boolean {
  return now - lastCheck > VISIBLE_CHECK_AFTER_MS;
}
