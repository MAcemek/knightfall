import { useLiveQuery } from 'dexie-react-hooks';
import { db, KEYS, type SelfReview, type StoredGame } from '../../../shared/db.ts';
import { getAnalysisPrefs, getGame, type AnalysisPrefs } from '../../../shared/analysis/index.ts';
import { getSettings } from '../../../shared/settings.ts';
import { sanitizeSettings, type SelfReviewMode } from '../../../shared/settingsLogic.ts';

/** IndexedDB side of the engine-off review. The rules are in selfReviewLogic.ts. */

export async function saveSelfReview(row: SelfReview): Promise<void> {
  await db.selfReviews.put(row);
}

/** The stored row of a game: undefined while loading, null when there is none. Callers clean it with cleanSelfReviewRow. */
export function useSelfReviewRow(gameKey: string): unknown {
  return useLiveQuery(async () => (await db.selfReviews.get(gameKey)) ?? null, [gameKey]);
}

export interface GateInputs {
  mode: SelfReviewMode;
  game: StoredGame | undefined;
  hasAnalysis: boolean;
  review: SelfReview | undefined;
  prefs: AnalysisPrefs;
}

/** The mode comes from the stored settings (the in-memory copy may still be loading). */
async function readMode(): Promise<SelfReviewMode> {
  const row = await db.kv.get(KEYS.settings);
  return (row ? sanitizeSettings(row.value) : getSettings()).selfReview;
}

/** Everything the gate decides on, read once. Null when the mode is off (nothing else is read). */
export async function loadGateInputs(gameKey: string): Promise<GateInputs | null> {
  const mode = await readMode();
  if (mode === 'off') return null;
  const [game, analysed, review, prefs] = await Promise.all([
    getGame(gameKey),
    db.analyses.where('gameKey').equals(gameKey).count(),
    db.selfReviews.get(gameKey),
    getAnalysisPrefs(),
  ]);
  return { mode, game, hasAnalysis: analysed > 0, review, prefs };
}
