import { useEffect, useState } from 'react';
import type { Puzzle } from '@knightfall/core';
import { ProgressDots, PuzzleBoard, PuzzlePrompt, usePuzzleRunner } from '../../shared/PuzzlePlayer/index.ts';
import { Button, Icons, Pill } from '../../shared/ui.tsx';
import { formatSeconds, type RushAttempt } from './rushLogic.ts';

/**
 * Untimed replay of a puzzle from the finished run. ←/→ step through the run, Esc closes.
 */
export function ReviewModal({ attempts, index, onIndex, onClose }: {
  attempts: RushAttempt[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const attempt = attempts[index];
  const [puzzle, setPuzzle] = useState<Puzzle>(() => ({ ...attempt.puzzle }));
  const [shownAttempt, setShownAttempt] = useState(attempt);
  if (shownAttempt !== attempt) {
    // Browsing to another puzzle: load it during render (no extra reset pass).
    setShownAttempt(attempt);
    setPuzzle({ ...attempt.puzzle });
  }
  const runner = usePuzzleRunner(puzzle);
  const restart = () => setPuzzle({ ...attempt.puzzle });

  const hasPrev = index > 0;
  const hasNext = index < attempts.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onIndex(index + 1);
      else if (e.key.toLowerCase() === 'h') runner.hint();
      else if (e.key.toLowerCase() === 'r') {
        if (runner.status === 'failed') runner.retry();
        else restart();
      } else if (e.key.toLowerCase() === 's') runner.showSolution();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const finished = runner.status === 'solved' || runner.status === 'solution';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/80 p-3 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="max-h-[100dvh] w-full max-w-[min(560px,calc(100dvh-12rem))] animate-pop overflow-y-auto rounded-2xl border border-ink-700 bg-ink-850 p-3 shadow-2xl sm:p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-white ${attempt.solved ? 'bg-good-500' : 'bg-bad-500'}`}>
            {attempt.solved ? Icons.check('h-4 w-4 stroke-[3]') : Icons.x('h-4 w-4 stroke-[3]')}
          </span>
          <div className="min-w-0">
            <div className="font-bold leading-tight">
              Puzzle {attempt.index + 1} · <span className="font-mono">{attempt.puzzle.rating}</span>
            </div>
            <div className="text-xs text-ink-400">
              {attempt.solved ? `Solved in ${formatSeconds(attempt.timeMs)} during the run` : `Missed after ${formatSeconds(attempt.timeMs)}`}
            </div>
          </div>
          <button className="ml-auto rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100" onClick={onClose} aria-label="Close review">
            {Icons.x('h-5 w-5')}
          </button>
        </div>

        <PuzzleBoard runner={runner} />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <PuzzlePrompt runner={runner} className="text-base" />
          <ProgressDots runner={runner} />
        </div>
        {attempt.puzzle.themes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {attempt.puzzle.themes.slice(0, 5).map((t) => (
              <Pill key={t} className="bg-ink-800 text-ink-300">
                {t.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}
              </Pill>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={!hasPrev} onClick={() => onIndex(index - 1)} aria-label="Previous puzzle">
            {Icons.next('h-4 w-4 rotate-180')}
          </Button>
          {runner.status === 'failed' ? (
            <Button size="sm" variant="primary" onClick={runner.retry}>
              {Icons.retry('h-4 w-4')} Retry
            </Button>
          ) : (
            <Button size="sm" onClick={runner.hint} disabled={runner.status !== 'player'}>
              {Icons.bulb('h-4 w-4')} Hint
            </Button>
          )}
          {finished ? (
            <Button size="sm" onClick={restart}>
              {Icons.retry('h-4 w-4')} Again
            </Button>
          ) : (
            <Button size="sm" onClick={runner.showSolution} disabled={runner.status === 'intro' || runner.status === 'idle'}>
              {Icons.eye('h-4 w-4')} Solution
            </Button>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" disabled={!hasNext} onClick={() => onIndex(index + 1)} aria-label="Next puzzle">
            {Icons.next('h-4 w-4')}
          </Button>
        </div>
        <div className="mt-2 hidden text-center text-[11px] text-ink-500 sm:block">
          ← → browse · H hint · R retry · S solution · Esc close
        </div>
      </div>
    </div>
  );
}
