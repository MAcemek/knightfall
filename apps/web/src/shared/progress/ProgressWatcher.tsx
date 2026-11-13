import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { GAME_PUZZLE_PREFIX, type Glicko } from '@knightfall/core';
import { db, defaults, getKV, KEYS, setKV, type StreakState } from '../db.ts';
import { sfx } from '../fx/sound.ts';
import { toast } from '../toast.tsx';
import { achievementById, buildSnapshot, newlyEarned, type AchievementDef, type AchievementTier, type ProgressSnapshot } from './achievements.ts';
import { syncReviewQueue } from './reviews.ts';

/** Read everything the achievement rules need. Safe inside liveQuery (read-only). */
export async function loadSnapshot(): Promise<ProgressSnapshot> {
  const [attempts, rushRuns, battles, daily, rating, streak, customCount] = await Promise.all([
    db.attempts.toArray(),
    db.rushRuns.toArray(),
    db.battles.toArray(),
    db.daily.toArray(),
    getKV<Glicko>(KEYS.puzzleRating, defaults.puzzleRating),
    getKV<StreakState>(KEYS.puzzleStreak, defaults.puzzleStreak),
    // Puzzles generated from reviewed games are not "created" by hand: they do not count for achievements.
    db.customPuzzles.filter((p) => !p.id.startsWith(GAME_PUZZLE_PREFIX)).count(),
  ]);
  return buildSnapshot({ attempts, rushRuns, battles, daily, puzzleRating: rating.rating, puzzleStreak: streak, customCount });
}

/**
 * Unlock whatever the snapshot has earned. Returns the definitions to announce.
 * The first ever run "seeds" silently, so progress made before achievements existed causes no toast storm.
 */
export async function syncAchievements(snapshot: ProgressSnapshot): Promise<AchievementDef[]> {
  return db.transaction('rw', db.kv, db.achievements, async () => {
    const seeded = await getKV<boolean>(KEYS.achievementsSeeded, false);
    const have = new Set((await db.achievements.toArray()).map((r) => r.id));
    const fresh = newlyEarned(snapshot, have);
    const now = Date.now();
    if (fresh.length) await db.achievements.bulkAdd(fresh.map((id, i) => ({ id, at: now + i })));
    if (!seeded) {
      await setKV(KEYS.achievementsSeeded, true);
      return [];
    }
    return fresh.map((id) => achievementById(id)).filter((a): a is AchievementDef => !!a);
  });
}

const TIER_TONE: Record<AchievementTier, 'ember' | 'sky' | 'violet'> = { bronze: 'sky', silver: 'violet', gold: 'ember' };

function announce(unlocked: AchievementDef[]) {
  if (!unlocked.length) return;
  sfx.sparkle();
  if (unlocked.length > 3) {
    toast({ title: `${unlocked.length} achievements unlocked`, body: unlocked.map((a) => a.title).join(' · '), icon: 'trophy', tone: 'ember', to: '/stats', durationMs: 6000 });
    return;
  }
  for (const a of unlocked) toast({ title: `Achievement · ${a.title}`, body: a.desc, icon: a.icon, tone: TIER_TONE[a.tier], to: '/stats', durationMs: 5200 });
}

/** Serialises the background writes (also makes React StrictMode's double effects harmless). */
let chain: Promise<unknown> = Promise.resolve();
function enqueue(job: () => Promise<void>) {
  chain = chain.then(job).catch((e) => console.error('Progress sync failed', e));
}

/**
 * Mounted once in <App/>. Watches the local history and, in the background:
 *  - feeds missed puzzles into the review queue (every mode that writes Attempt rows, no per-mode wiring);
 *  - unlocks achievements and shows a toast for each new one.
 * Renders nothing.
 */
export function ProgressWatcher() {
  const attemptCount = useLiveQuery(() => db.attempts.count(), []);
  const snapshot = useLiveQuery(loadSnapshot, []);

  useEffect(() => {
    if (attemptCount === undefined) return;
    enqueue(async () => {
      await syncReviewQueue();
    });
  }, [attemptCount]);

  useEffect(() => {
    if (!snapshot) return;
    enqueue(async () => announce(await syncAchievements(snapshot)));
  }, [snapshot]);

  return null;
}
