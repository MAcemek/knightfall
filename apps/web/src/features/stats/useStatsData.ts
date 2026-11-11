import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../shared/db.ts';
import type { AchievementRow, Attempt, BattleRecord, DailyRecord, RushRun } from '../../shared/db.ts';
import { loadSnapshot } from '../../shared/progress/index.ts';
import type { ProgressSnapshot } from '../../shared/progress/index.ts';
import { findPuzzle } from '../../shared/puzzleSource.ts';

export interface StatsData {
  attempts: Attempt[];
  rushRuns: RushRun[];
  battles: BattleRecord[];
  daily: DailyRecord[];
  unlocked: AchievementRow[];
  snapshot: ProgressSnapshot;
}

/** Everything the Stats page shows, live. Undefined while loading. */
export function useStatsData(): StatsData | undefined {
  return useLiveQuery(async () => {
    const [attempts, rushRuns, battles, daily, unlocked, snapshot] = await Promise.all([
      db.attempts.toArray(),
      db.rushRuns.toArray(),
      db.battles.toArray(),
      db.daily.toArray(),
      db.achievements.toArray(),
      loadSnapshot(),
    ]);
    return { attempts, rushRuns, battles, daily, unlocked, snapshot };
  }, []);
}

const THEME_MODES: ReadonlySet<string> = new Set(['rated', 'rush', 'theme', 'review']);

/** Theme rows for accuracy-by-theme. Undefined while old attempts are being resolved. */
export function useThemeRows(attempts: Attempt[] | undefined): { themes: string[]; solved: boolean }[] | undefined {
  const [rows, setRows] = useState<{ themes: string[]; solved: boolean }[] | undefined>(undefined);
  useEffect(() => {
    if (!attempts) return;
    let alive = true;
    const recent = attempts
      .filter((a) => THEME_MODES.has(a.mode))
      .sort((a, b) => b.at - a.at)
      .slice(0, 500);
    (async () => {
      try {
        const resolved = await Promise.all(
          recent.map(async (a) => {
            const themes = a.themes ?? (await findPuzzle(a.puzzleId, a.puzzleRating))?.themes;
            return themes ? { themes, solved: a.solved } : null;
          }),
        );
        if (alive) setRows(resolved.filter((r): r is { themes: string[]; solved: boolean } => r !== null));
      } catch {
        if (alive) setRows([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempts]);
  return rows;
}
