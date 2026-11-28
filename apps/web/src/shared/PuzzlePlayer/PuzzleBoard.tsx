import type { ReactNode } from 'react';
import { Board } from '../Board/index.ts';
import type { PuzzleRunner } from './usePuzzleRunner.ts';

/**
 * Board wired to a puzzle runner. Interactive only on the solver's turn.
 * `orientation` overrides the solver-side default (e.g. a Flip button); `children` render as board overlays.
 */
export function PuzzleBoard({ runner, orientation, className, children }: {
  runner: PuzzleRunner;
  orientation?: 'white' | 'black';
  className?: string;
  children?: ReactNode;
}) {
  const peek = runner.peek;
  const arrows = peek ? (peek.arrow ? [peek.arrow] : undefined) : runner.hintArrow ? [runner.hintArrow] : undefined;
  return (
    <Board
      fen={peek ? peek.fen : runner.fen}
      orientation={orientation ?? runner.orientation}
      interactive={runner.interactive}
      movableColor={runner.solverColor}
      lastMove={peek ? peek.lastMove : runner.lastMove}
      mark={peek ? null : runner.mark}
      pulse={peek ? [] : runner.pulse}
      arrows={arrows}
      shakeKey={runner.shakeKey}
      onMove={runner.playMove}
      onPremove={runner.status === 'opponent' || runner.status === 'intro' ? runner.setPremove : undefined}
      premove={runner.premove}
      annotationKey={runner.puzzle?.id}
      positionKey={runner.positionKey}
      sweepKey={runner.solvedKey}
      className={className}
    >
      {children}
    </Board>
  );
}

/** One-line prompt above/below the board: "Black to move", "Correct!", ... */
export function PuzzlePrompt({ runner, className = '', idleText = 'Loading…' }: {
  runner: PuzzleRunner;
  className?: string;
  /** Shown while no puzzle is loaded (status 'idle'). */
  idleText?: string;
}) {
  const side = runner.solverColor === 'w' ? 'White' : 'Black';
  const swatch = runner.solverColor === 'w' ? 'bg-ink-100' : 'bg-ink-950 ring-1 ring-ink-400';
  let text: string;
  let tone = 'text-ink-100';
  if (runner.review && runner.status === 'player') {
    return (
      <div className={`flex items-center gap-2.5 text-lg font-bold text-sky-400 ${className}`}>
        <span className={`inline-block h-4 w-4 rounded-sm ${swatch}`} />
        <span>Earlier position · Forward to play on</span>
      </div>
    );
  }
  if (runner.review) {
    return (
      <div className={`flex items-center gap-2.5 text-lg font-bold text-sky-400 ${className}`}>
        <span className={`inline-block h-4 w-4 rounded-sm ${swatch}`} />
        <span>
          Reviewing · move {runner.review.index} of {runner.review.total}
        </span>
      </div>
    );
  }
  switch (runner.status) {
    case 'intro':
      text = 'Get ready…';
      tone = 'text-ink-300';
      break;
    case 'opponent':
      text = runner.notice ?? 'Correct! Keep going…';
      tone = 'text-good-400';
      break;
    case 'solved':
      text = runner.notice ?? 'Solved!';
      tone = 'text-good-400';
      break;
    case 'failed':
      text = 'Incorrect';
      tone = 'text-bad-400';
      break;
    case 'solution':
      text = 'Solution';
      tone = 'text-ember-400';
      break;
    case 'player':
      if (runner.lastWrong) {
        text = 'Not quite — try again';
        tone = 'text-ember-400';
      } else {
        text = runner.notice ?? (runner.progress.done > 0 ? 'Best move! Keep going' : `${side} to move`);
        tone = runner.progress.done > 0 ? 'text-good-400' : 'text-ink-100';
      }
      break;
    default:
      text = idleText;
      tone = 'text-ink-400';
  }
  return (
    <div className={`flex items-center gap-2.5 text-lg font-bold ${tone} ${className}`}>
      <span className={`inline-block h-4 w-4 rounded-sm ${swatch}`} />
      {/* Keyed on the text: each new verdict ("Best move!", "Not quite") settles in instead of swapping in place. */}
      <span key={text} className="inline-block animate-feedback-in">{text}</span>
    </div>
  );
}

export function ProgressDots({ runner }: { runner: PuzzleRunner }): ReactNode {
  const { done, total } = runner.progress;
  return (
    <div className="flex gap-1.5">
      {/* A dot remounts when it fills (key includes the state), so only the dot that just turned green animates. */}
      {Array.from({ length: total }, (_, i) =>
        i < done ? (
          <span key={`${i}-done`} className="h-2 w-6 origin-left animate-dot-fill rounded-full bg-good-500" />
        ) : (
          <span key={`${i}-todo`} className="h-2 w-6 rounded-full bg-ink-700" />
        ),
      )}
    </div>
  );
}
