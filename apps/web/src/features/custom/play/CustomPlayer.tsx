import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Puzzle } from '@knightfall/core';
import { burstAt, confetti, PALETTES, sfx } from '../../../shared/fx/index.ts';
import { ProgressDots, PuzzleBoard, PuzzlePrompt, usePuzzleRunner, type RunnerResult } from '../../../shared/PuzzlePlayer/index.ts';
import { Button, GameLayout, Icons, Panel, Pill } from '../../../shared/ui.tsx';
import { Kbd, ThemeTag, useHotkeys } from '../bits.tsx';
import { displayTitle } from '../logic.ts';
import { ratingTier } from '../editor/DetailsStep.tsx';

export interface CustomPlayerProps {
  /** Must be referentially stable; a new object restarts the puzzle. */
  puzzle: Puzzle;
  /** Called once per attempt with the first outcome. */
  onResult?: (r: RunnerResult) => void;
  /** Extra buttons (Edit / Share / Save…). */
  actions?: ReactNode;
  /** Optional stats block (plays / solves). */
  stats?: ReactNode;
  /** Small label above the title (e.g. "Shared puzzle"). */
  kicker?: ReactNode;
  /** Optional "next puzzle" handler. */
  onNext?: () => void;
}

/** Plays a custom puzzle with the full feedback treatment: sounds, badges, bursts, confetti. */
export function CustomPlayer({ puzzle, onResult, actions, stats, kicker, onNext }: CustomPlayerProps) {
  const [instance, setInstance] = useState<Puzzle>(puzzle);
  const [result, setResult] = useState<RunnerResult | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const boardWrap = useRef<HTMLDivElement>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    setInstance(puzzle);
    setResult(null);
  }, [puzzle]);

  const squareEl = (sq: string) => boardWrap.current?.querySelector(`[data-square="${sq}"]`);

  const runner = usePuzzleRunner(instance, {
    onCorrectMove: ({ square }) => {
      burstAt(squareEl(square), { count: 14, power: 4, size: 4, colors: PALETTES.good, life: 40, gravity: 0.12 });
    },
    onComplete: (r) => {
      setResult(r);
      onResultRef.current?.(r);
      // Confetti only for a first-try solve; a solve after a retry still gets the banner + burst below.
      if (r.solved) setTimeout(() => confetti({ count: r.hintsUsed ? 50 : 100 }), 120);
    },
  });

  useEffect(() => {
    if (runner.status !== 'solved') return;
    setCelebrate((c) => c + 1);
    const t = setTimeout(() => burstAt(boardWrap.current, { count: 46, power: 10, size: 6, colors: PALETTES.ember, life: 70, shape: 'star' }), 120);
    return () => clearTimeout(t);
  }, [runner.status]);

  // Hide the "Solved!" banner after a moment so the final position stays visible.
  const [banner, setBanner] = useState(false);
  useEffect(() => {
    if (!celebrate) return;
    setBanner(true);
    const t = setTimeout(() => setBanner(false), 1700);
    return () => clearTimeout(t);
  }, [celebrate]);

  const finished = runner.status === 'solved' || runner.status === 'solution';
  const again = () => {
    setInstance({ ...puzzle });
    setResult(null);
    sfx.click();
  };

  useHotkeys({
    h: runner.hint,
    r: () => (finished ? again() : runner.retry()),
    s: runner.showSolution,
    n: () => (finished && onNext ? onNext() : finished ? again() : undefined),
  });

  const tier = ratingTier(puzzle.rating);
  const title = displayTitle({ title: puzzle.title, fen: puzzle.fen, opponentFirst: puzzle.opponentFirst, themes: puzzle.themes });

  return (
    <GameLayout
      board={
        <div ref={boardWrap}>
          <PuzzleBoard runner={runner}>
            {banner && (
              <div className="pointer-events-none absolute inset-0 z-[45] flex items-center justify-center">
                <div className="flex animate-pop items-center gap-2 rounded-2xl bg-ink-950/85 px-6 py-3 text-2xl font-black text-good-400 shadow-2xl ring-2 ring-good-500/70 backdrop-blur-sm sm:text-3xl">
                  {Icons.check('h-7 w-7')} Solved!
                </div>
              </div>
            )}
          </PuzzleBoard>
        </div>
      }
      side={
        <div className="space-y-4">
          <Panel className="space-y-4">
            <div>
              {kicker && <div className="mb-1 text-xs font-bold uppercase tracking-wider text-ember-400">{kicker}</div>}
              <h2 className="text-xl font-extrabold leading-tight">{title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Pill className="font-mono">
                  <span className={tier.tone}>●</span> {puzzle.rating}
                </Pill>
                {puzzle.themes.map((t) => (
                  <ThemeTag key={t} theme={t} />
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-xl bg-ink-900 p-3">
              <PuzzlePrompt runner={runner} />
              <ProgressDots runner={runner} />
            </div>

            {result && (
              <div
                key={celebrate + (result.solved ? 's' : 'f')}
                className={`animate-pop rounded-xl px-3 py-2.5 text-sm font-semibold ${
                  result.solved ? 'bg-good-500/10 text-good-400 ring-1 ring-good-500/30' : 'bg-bad-500/10 text-bad-400 ring-1 ring-bad-500/30'
                }`}
              >
                {result.solved
                  ? `Solved in ${(result.timeMs / 1000).toFixed(1)}s${result.hintsUsed ? ` with ${result.hintsUsed} hint${result.hintsUsed > 1 ? 's' : ''}` : ' — clean!'}`
                  : runner.status === 'solution'
                    ? 'Here is the intended line.'
                    : runner.status === 'solved'
                      ? 'Got there on a retry. Nice recovery!'
                      : 'Not quite. Retry or reveal the solution.'}
              </div>
            )}

            {finished ? (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={again}>
                  {Icons.retry('h-4 w-4')} Play again
                </Button>
                {onNext ? (
                  <Button variant="primary" onClick={onNext}>
                    Next {Icons.next('h-4 w-4')}
                  </Button>
                ) : (
                  <Button variant="primary" onClick={runner.showSolution} disabled={runner.status === 'solution'}>
                    {Icons.eye('h-4 w-4')} Solution
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" onClick={runner.hint} disabled={runner.status !== 'player'}>
                  {Icons.bulb('h-4 w-4')} Hint
                </Button>
                <Button size="sm" variant={runner.status === 'failed' ? 'primary' : 'secondary'} onClick={runner.retry} disabled={runner.status !== 'failed'}>
                  {Icons.retry('h-4 w-4')} Retry
                </Button>
                <Button size="sm" onClick={runner.showSolution} disabled={runner.status === 'idle' || runner.status === 'intro'}>
                  {Icons.eye('h-4 w-4')} Solution
                </Button>
              </div>
            )}

            {actions && <div className="flex flex-wrap gap-2 border-t border-ink-700/60 pt-4">{actions}</div>}

            <div className="hidden flex-wrap gap-x-3 gap-y-1.5 text-xs text-ink-400 sm:flex">
              <span>
                <Kbd>H</Kbd> hint
              </span>
              <span>
                <Kbd>R</Kbd> retry
              </span>
              <span>
                <Kbd>S</Kbd> solution
              </span>
              {finished && (
                <span>
                  <Kbd>N</Kbd> {onNext ? 'next' : 'again'}
                </span>
              )}
            </div>
          </Panel>
          {stats}
        </div>
      }
    />
  );
}
