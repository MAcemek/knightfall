import { useCallback, useState } from 'react';
import type { BattleSettings } from '@knightfall/core';
import { parsePrefs, type FriendPrefs, type Series } from './friendSettings.ts';

const STORAGE_KEY = 'knightfall.friendBattlePrefs';

export interface PrefsPatch {
  settings?: Partial<BattleSettings>;
  series?: Series;
}

function load(): FriendPrefs {
  try {
    return parsePrefs(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parsePrefs(null);
  }
}

/** The friend-battle options (time, difficulty, best of), remembered on this device. */
export function useFriendPrefs(): [FriendPrefs, (patch: PrefsPatch) => void] {
  const [prefs, setPrefs] = useState<FriendPrefs>(load);
  const update = useCallback((patch: PrefsPatch) => {
    setPrefs((p) => {
      const next: FriendPrefs = { settings: { ...p.settings, ...patch.settings }, series: patch.series ?? p.series };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: the choice just is not remembered */
      }
      return next;
    });
  }, []);
  return [prefs, update];
}
