import { useLiveQuery } from 'dexie-react-hooks';
import { getKV, KEYS, setKV } from '../../shared/db.ts';
import { recordBest, sanitizeBests, type VisionBests, type VisionColor, type VisionDrill } from './visionLogic.ts';

const readBests = async () => sanitizeBests(await getKV<unknown>(KEYS.visionBest, {}));

/** Best scores, live. Undefined until the first read finishes. */
export function useVisionBests(): VisionBests | undefined {
  return useLiveQuery(readBests, []);
}

/** Saves a finished run. Returns whether it beat the previous best, and what that best was. */
export async function saveRun(drill: VisionDrill, color: VisionColor, score: number): Promise<{ isNew: boolean; previous: number | null }> {
  const result = recordBest(await readBests(), drill, color, score);
  if (result.isNew) await setKV(KEYS.visionBest, result.bests);
  return { isNew: result.isNew, previous: result.previous };
}
