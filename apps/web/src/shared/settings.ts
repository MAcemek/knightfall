import { useSyncExternalStore } from 'react';
import { getKV, KEYS, setKV } from './db.ts';
import { setMuted, setVolume } from './fx/sound.ts';
import { boardTheme, DEFAULT_SETTINGS, migrateLegacy, sanitizeSettings, type Settings } from './settingsLogic.ts';

/**
 * App settings: one in-memory snapshot (sync reads for the board/sound), persisted in Dexie kv
 * (KEYS.settings) with a localStorage mirror so the first paint already has the right board colours.
 * Read with useSettings() in components or getSettings() elsewhere; write with setSetting().
 */

const CACHE_KEY = 'kf:settings';

function readCache(): Settings | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function readLegacy(): Settings {
  try {
    return migrateLegacy({ muted: localStorage.getItem('kf:muted'), autoNext: localStorage.getItem('kf:puzzles:autoNext') });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings = readCache() ?? readLegacy();
const listeners = new Set<() => void>();

/** Push the snapshot into the DOM (board colours, animation speed) and the sound engine. */
function apply(s: Settings) {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const theme = boardTheme(s.boardTheme);
    root.style.setProperty('--color-sq-light', theme.light);
    root.style.setProperty('--color-sq-dark', theme.dark);
    root.dataset.anim = s.animSpeed;
  }
  setVolume(s.volume);
  setMuted(!s.sound);
}

function commit(next: Settings, persist: boolean) {
  current = next;
  apply(next);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  if (persist) void setKV(KEYS.settings, next).catch(() => {});
  listeners.forEach((fn) => fn());
}

apply(current);

export function getSettings(): Settings {
  return current;
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (current[key] === value) return;
  commit(sanitizeSettings({ ...current, [key]: value }), true);
}

export function resetSettings(): void {
  commit(DEFAULT_SETTINGS, true);
}

/** Live settings snapshot; re-renders the component when any setting changes. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

/** Load the persisted settings from IndexedDB (call once at startup). First run migrates the v1 flags. */
export async function hydrateSettings(): Promise<void> {
  try {
    const stored = await getKV<unknown>(KEYS.settings, null);
    if (stored === null) await setKV(KEYS.settings, current);
    else commit(sanitizeSettings(stored), false);
  } catch {
    /* private mode / no IndexedDB: keep the in-memory snapshot */
  }
}

/** True when decorative motion should be skipped (setting "Off" or the OS reduced-motion preference). */
export function motionOff(): boolean {
  if (current.animSpeed === 'off') return true;
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Multiplier for JS-driven decorative durations (CSS uses --kf-speed). */
export function motionScale(): number {
  return current.animSpeed === 'fast' ? 0.6 : 1;
}
