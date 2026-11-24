import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { BATTLE_MAX_STRIKES, type Puzzle } from '@knightfall/core';
import { Board } from '../../shared/Board/index.ts';
import { PuzzleBoard, PuzzlePrompt, ProgressDots, usePuzzleRunner } from '../../shared/PuzzlePlayer/index.ts';
import { PhoneStepper, SolutionStepper } from '../puzzles/components/SolutionStepper.tsx';
import { useHotkeys } from '../puzzles/useHotkeys.ts';
import { prefetchSequence, sequencePuzzle } from '../../shared/puzzleSource.ts';
import { burstAt, PALETTES, sfx } from '../../shared/fx/index.ts';
import { GameLayout, Icons, Panel, Pill } from '../../shared/ui.tsx';
import type { PlayedPuzzle } from './battleState.ts';
import { PuzzleChips } from './PuzzleChips.tsx';

const NEXT_AFTER_SOLVE_MS = 380;
const NEXT_AFTER_MISS_MS = 900;

/** True from the moment the server clock runs out (the server's end follows right after). */
export function useTimeUp(endsAt: number, serverNow: () => number): boolean {
  const [timeUp, setTimeUp] = useState(false);
  useEffect(() => {
    if (!endsAt) return;
    const t = setTimeout(() => setTimeUp(true), Math.max(0, endsAt - serverNow()));
    return () => clearTimeout(t);
  }, [endsAt, serverNow]);
  return timeUp;
}

/**
 * The puzzle loop shared by 1v1 battles and club races: the seeded puzzle sequence on the board, the control
 * dock, and a side panel. The caller adds the HUD (`top`), extra side content (`sideExtra`, e.g. the club
 * ranking) and a footer. Mount with a key so every game starts fresh.
 */
export function RaceBoard({ seed, ramp, playing, timeUp, strikes, history, onResult, scoreRef, top, sideExtra, sideFooter, waitingText }: {
  seed: number;
  ramp: { start: number; step: number };
  playing: boolean;
  timeUp: boolean;
  /** My strikes so far; at 3 the board locks and no further puzzle loads. */
  strikes: number;
  history: readonly PlayedPuzzle[];
  onResult: (puzzle: { id: string; rating: number }, solved: boolean) => void;
  /** Element that bursts confetti on a solve (the HUD score box). */
  scoreRef: RefObject<HTMLElement | null>;
  top?: ReactNode;
  sideExtra?: ReactNode;
  sideFooter?: ReactNode;
  /** Shown under "Out of strikes". */
  waitingText: string;
}) {
  const [loadIndex, setLoadIndex] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const streak = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const strikesRef = useRef(strikes);
  strikesRef.current = strikes;
  const out = strikes >= BATTLE_MAX_STRIKES;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Load the puzzle for the current index (identical for everyone: same seed + index).
  useEffect(() => {
    let alive = true;
    setLoadError(null);
    sequencePuzzle(seed, loadIndex, ramp)
      .then((p) => alive && setPuzzle({ ...p })) // fresh identity so the runner always resets
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : 'Could not load puzzles.'));
    prefetchSequence(seed, loadIndex + 1, 3, ramp);
    return () => {
      alive = false;
    };
  }, [seed, loadIndex, ramp]);

  const runner = usePuzzleRunner(playing ? puzzle : null, {
    solvedSound: false,
    autoRetry: false,
    replyDelay: 240,
    introDelay: 340,
    onComplete: ({ puzzle: p, solved }) => {
      onResult({ id: p.id, rating: p.rating }, solved);
      if (solved) {
        streak.current++;
        sfx.combo(streak.current);
        burstAt(scoreRef.current, { colors: streak.current >= 5 ? PALETTES.ember : PALETTES.good, count: 18 + Math.min(30, streak.current * 3), power: 6 });
        if (streak.current > 0 && streak.current % 5 === 0) sfx.sparkle();
      } else {
        streak.current = 0;
        sfx.strike();
      }
      const strikesAfter = strikesRef.current + (solved ? 0 : 1);
      if (strikesAfter >= BATTLE_MAX_STRIKES) return;
      timers.current.push(setTimeout(() => setLoadIndex((i) => i + 1), solved ? NEXT_AFTER_SOLVE_MS : NEXT_AFTER_MISS_MS));
    },
  });

  // ←/→ step back to the opponent's last move and forward again (the clock keeps running).
  useHotkeys({ arrowleft: () => runner.stepBack(), arrowright: () => runner.stepForward() }, playing);

  const locked = out || timeUp;
  const lastSolved = history.at(-1)?.solved;

  const board = (
    <div className="relative">
      {playing ? (
        <PuzzleBoard runner={runner}>{locked && <LockOverlay out={out} waitingText={waitingText} />}</PuzzleBoard>
      ) : (
        <Board fen={puzzle?.fen ?? '8/8/8/8/8/8/8/8 w - - 0 1'} orientation={sideToMoveOrientation(puzzle)} />
      )}
      {loadError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-ink-950/85 p-6 text-center text-sm font-semibold text-bad-400">{loadError}</div>
      )}
    </div>
  );

  return (
    <GameLayout
      top={top}
      board={board}
      dock={
        <div className="mt-3 space-y-2 max-lg:mt-2 lg:hidden">
          <div className="flex items-center justify-between gap-3" data-testid="prompt-line">
            <PuzzlePrompt runner={runner} idleText="Get ready…" className="text-base!" />
            {puzzle && playing && <Pill className="font-mono">#{loadIndex + 1} · {puzzle.rating}</Pill>}
          </div>
          <PhoneStepper runner={runner} />
        </div>
      }
      side={
        <div className="space-y-3">
          <Panel className="space-y-4">
            <div className="flex items-center justify-between gap-3 max-lg:hidden">
              <PuzzlePrompt runner={runner} idleText="Get ready…" />
              {puzzle && playing && <Pill className="font-mono">#{loadIndex + 1} · {puzzle.rating}</Pill>}
            </div>
            <div className="max-lg:hidden">
              <SolutionStepper runner={runner} />
            </div>
            <div className="flex min-h-2 items-center justify-between gap-2">
              <ProgressDots runner={runner} />
              {lastSolved !== undefined && streak.current >= 2 && (
                <span key={streak.current} className="animate-pop text-sm font-black text-ember-400">
                  {Icons.flame('inline h-4 w-4 -mt-0.5')} {streak.current} in a row
                </span>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">This battle</div>
              {history.length ? (
                <PuzzleChips history={history} />
              ) : (
                <div className="text-sm text-ink-400">Solve fast — every puzzle counts. A miss costs a strike.</div>
              )}
            </div>
            {sideFooter}
          </Panel>
          {sideExtra}
        </div>
      }
    />
  );
}

export function sideToMoveOrientation(p: Puzzle | null): 'white' | 'black' {
  if (!p) return 'white';
  const stm = p.fen.split(' ')[1];
  // Lichess puzzles: the side to move in the FEN plays the setup move; the solver is the other side.
  const solverWhite = p.opponentFirst ? stm === 'b' : stm === 'w';
  return solverWhite ? 'white' : 'black';
}

function LockOverlay({ out, waitingText }: { out: boolean; waitingText: string }) {
  return (
    <div className="absolute inset-0 z-50 flex animate-pop flex-col items-center justify-center gap-2 bg-ink-950/75 p-6 text-center backdrop-blur-[2px]">
      <div className={`flex h-14 w-14 items-center justify-center rounded-full ${out ? 'bg-bad-500/20 text-bad-400' : 'bg-ember-500/20 text-ember-400'}`}>
        {out ? Icons.x('h-8 w-8') : Icons.clock('h-8 w-8')}
      </div>
      <div className="text-xl font-extrabold">{out ? 'Out of strikes' : "Time's up!"}</div>
      <div className="text-sm text-ink-300">{out ? waitingText : 'Tallying the final score…'}</div>
      <div className="mt-1 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-ink-400" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}
