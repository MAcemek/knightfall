import { useCallback, useEffect, useRef, useState } from 'react';
import type { Puzzle } from '@knightfall/core';
import { usePuzzleRunner, type PuzzleRunner, type RunnerResult } from '../../shared/PuzzlePlayer/index.ts';
import { prefetchSequence, sequencePuzzle } from '../../shared/puzzleSource.ts';
import { db, type RushMode } from '../../shared/db.ts';
import { sfx } from '../../shared/fx/index.ts';
import { applyResult, initialCore, RUSH_MODES, toRushRun, type RushModeConfig, type RunCore } from './rushLogic.ts';

export type RushPhase = 'countdown' | 'playing' | 'ending' | 'over';
export type EndReason = 'time' | 'strikes' | 'quit';

export interface SaveInfo {
  /** Score beat the previous best for this mode. */
  newBest: boolean;
  /** Best score before this run (0 if none). */
  prevBest: number;
  /** Whether the run was stored (runs with zero attempts are not). */
  saved: boolean;
}

export interface RushGame {
  cfg: RushModeConfig;
  phase: RushPhase;
  /** 3, 2, 1 during the countdown; 0 = "Go!". */
  count: number;
  showGo: boolean;
  runner: PuzzleRunner;
  core: RunCore;
  /** Index of the puzzle currently on the board. */
  currentIndex: number;
  remainingMs: number;
  elapsedMs: number;
  endReason: EndReason | null;
  flash: { kind: 'good' | 'bad'; key: number } | null;
  /** Increments on every solve / every combo milestone / every strike (effect triggers). */
  solveKey: number;
  milestoneKey: number;
  strikeKey: number;
  save: SaveInfo | null;
  error: string | null;
  retryLoad: () => void;
  quit: () => void;
}

const COUNT_STEP_MS = 750;
const NEXT_AFTER_SOLVE_MS = 250;
const NEXT_AFTER_MISS_MS = 600;

/** The i-th puzzle of this run, skipping any puzzle already seen in it (same buckets, alternate seeds). */
async function pickPuzzle(seed: number, index: number, ramp: RushModeConfig['ramp'], seen: Set<string>): Promise<Puzzle> {
  let p = await sequencePuzzle(seed, index, ramp);
  for (let k = 1; k < 6 && seen.has(p.id); k++) p = await sequencePuzzle(`${seed}:${k}`, index, ramp);
  // Fresh object identity so the runner always resets, even for a cached puzzle.
  return { ...p };
}

/** One Puzzle Rush run: countdown → timed/untimed sequence → game over (+ persistence). Remount for a new run. */
export function useRushGame(mode: RushMode): RushGame {
  const cfg = RUSH_MODES[mode];
  const [seed] = useState(() => (Math.random() * 2 ** 31) >>> 0);

  const [phase, setPhaseState] = useState<RushPhase>('countdown');
  const phaseRef = useRef<RushPhase>('countdown');
  const setPhase = (p: RushPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  const [core, setCoreState] = useState<RunCore>(initialCore);
  const coreRef = useRef<RunCore>(core);
  const setCore = (c: RunCore) => {
    coreRef.current = c;
    setCoreState(c);
  };

  const [count, setCount] = useState(3);
  const [showGo, setShowGo] = useState(false);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingMs, setRemaining] = useState(cfg.durationMs ?? 0);
  const [elapsedMs, setElapsed] = useState(0);
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const [flash, setFlash] = useState<RushGame['flash']>(null);
  const [solveKey, setSolveKey] = useState(0);
  const [milestoneKey, setMilestoneKey] = useState(0);
  const [strikeKey, setStrikeKey] = useState(0);
  const [save, setSave] = useState<SaveInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const seen = useRef(new Set<string>());
  const indexRef = useRef(0);
  const loadToken = useRef(0);
  const startAt = useRef(0);
  const endAt = useRef(0);
  const flashKey = useRef(0);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const show = useCallback((index: number, p: Promise<Puzzle>) => {
    const token = ++loadToken.current;
    setError(null);
    p.then((pz) => {
      if (!alive.current || token !== loadToken.current || phaseRef.current !== 'playing') return;
      seen.current.add(pz.id);
      setCurrentIndex(index);
      setPuzzle(pz);
      prefetchSequence(seed, index + 1, 3, cfg.ramp);
    }).catch((e: unknown) => {
      if (!alive.current || token !== loadToken.current) return;
      setError(e instanceof Error ? e.message : 'Could not load the next puzzle.');
    });
  }, [seed, cfg.ramp]);

  const loadIndex = useCallback((index: number) => {
    indexRef.current = index;
    show(index, pickPuzzle(seed, index, cfg.ramp, seen.current));
  }, [show, seed, cfg.ramp]);

  const persist = useCallback(async (c: RunCore) => {
    if (!c.attempts.length) {
      setSave({ newBest: false, prevBest: 0, saved: false });
      return;
    }
    try {
      const prev = await db.rushRuns.where('mode').equals(mode).toArray();
      const prevBest = prev.reduce((m, r) => Math.max(m, r.score), 0);
      const at = Date.now();
      await db.rushRuns.add(toRushRun(mode, c, at));
      await db.attempts.bulkAdd(
        c.attempts.map((a) => ({ puzzleId: a.puzzle.id, mode: 'rush' as const, solved: a.solved, puzzleRating: a.puzzle.rating, hintsUsed: 0, timeMs: a.timeMs, at })),
      );
      setSave({ newBest: c.score > prevBest, prevBest, saved: true });
    } catch {
      setSave({ newBest: false, prevBest: 0, saved: false });
    }
  }, [mode]);

  const end = useCallback((reason: EndReason) => {
    const p = phaseRef.current;
    if (p === 'ending' || p === 'over') return;
    clearTimers();
    loadToken.current++;
    setPhase('ending');
    setEndReason(reason);
    setShowGo(false);
    if (cfg.durationMs) setRemaining(reason === 'time' ? 0 : Math.max(0, endAt.current - performance.now()));
    else setElapsed(performance.now() - startAt.current);
    if (reason === 'time') sfx.go();
    later(() => setPhase('over'), reason === 'quit' ? 350 : 1400);
    void persist(coreRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.durationMs, persist]);

  const onComplete = useCallback((r: RunnerResult) => {
    if (phaseRef.current !== 'playing') return;
    const { core: next, milestone, struckOut } = applyResult(coreRef.current, {
      index: indexRef.current,
      puzzle: r.puzzle,
      solved: r.solved,
      timeMs: r.timeMs,
    });
    setCore(next);
    setFlash({ kind: r.solved ? 'good' : 'bad', key: ++flashKey.current });
    if (r.solved) {
      sfx.combo(next.combo);
      setSolveKey((k) => k + 1);
      if (milestone) {
        setMilestoneKey((k) => k + 1);
        later(() => sfx.sparkle(), 110);
      }
      later(() => loadIndex(indexRef.current + 1), NEXT_AFTER_SOLVE_MS);
    } else {
      later(() => sfx.strike(), 60);
      setStrikeKey((k) => k + 1);
      if (struckOut) end('strikes');
      else later(() => loadIndex(indexRef.current + 1), NEXT_AFTER_MISS_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadIndex, end]);

  const runner = usePuzzleRunner(puzzle, { onComplete, solvedSound: false, replyDelay: 250, introDelay: 350 });

  // Countdown (StrictMode-safe: cleanup cancels everything and the second mount restarts it).
  useEffect(() => {
    alive.current = true;
    seen.current = new Set();
    const first = pickPuzzle(seed, 0, cfg.ramp, seen.current);
    first.catch(() => {}); // surfaced via show() at "Go"
    prefetchSequence(seed, 1, 3, cfg.ramp);
    setCount(3);
    sfx.countdown();
    later(() => {
      setCount(2);
      sfx.countdown();
    }, COUNT_STEP_MS);
    later(() => {
      setCount(1);
      sfx.countdown();
    }, COUNT_STEP_MS * 2);
    later(() => {
      setCount(0);
      sfx.go();
      setShowGo(true);
      startAt.current = performance.now();
      endAt.current = startAt.current + (cfg.durationMs ?? 0);
      setPhase('playing');
      indexRef.current = 0;
      show(0, first);
      later(() => setShowGo(false), 650);
    }, COUNT_STEP_MS * 3);
    return () => {
      alive.current = false;
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clock.
  useEffect(() => {
    if (phase !== 'playing') return;
    let lastTick = -1;
    const id = setInterval(() => {
      const now = performance.now();
      if (cfg.durationMs) {
        const rem = Math.max(0, endAt.current - now);
        setRemaining(rem);
        const sec = Math.ceil(rem / 1000);
        if (rem > 0 && sec <= 10 && sec !== lastTick) {
          lastTick = sec;
          sfx.tick();
        }
        if (rem <= 0) end('time');
      } else {
        setElapsed(now - startAt.current);
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, cfg.durationMs, end]);

  // Warn before closing the tab mid-run.
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'countdown') return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [phase]);

  const retryLoad = useCallback(() => loadIndex(indexRef.current), [loadIndex]);
  const quit = useCallback(() => end('quit'), [end]);

  return {
    cfg,
    phase,
    count,
    showGo,
    runner,
    core,
    currentIndex,
    remainingMs,
    elapsedMs,
    endReason,
    flash,
    solveKey,
    milestoneKey,
    strikeKey,
    save,
    error,
    retryLoad,
    quit,
  };
}
