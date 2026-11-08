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
  return (
    <Board
      fen={runner.fen}
      orientation={orientation ?? runner.orientation}
      interactive={runner.status === 'player'}
      movableColor={runner.solverColor}
      lastMove={runner.lastMove}
      mark={runner.mark}
      pulse={runner.pulse}
      shakeKey={runner.shakeKey}
      onMove={runner.playMove}
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
  switch (runner.status) {
    case 'intro':
      text = 'Get ready…';
      tone = 'text-ink-300';
      break;
    case 'opponent':
      text = 'Correct! Keep going…';
      tone = 'text-good-400';
      break;
    case 'solved':
      text = 'Solved!';
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
      text = runner.progress.done > 0 ? 'Best move! Keep going' : `${side} to move`;
      tone = runner.progress.done > 0 ? 'text-good-400' : 'text-ink-100';
      break;
    default:
      text = idleText;
      tone = 'text-ink-400';
  }
  return (
    <div className={`flex items-center gap-2.5 text-lg font-bold ${tone} ${className}`}>
      <span className={`inline-block h-4 w-4 rounded-sm ${swatch}`} />
      <span>{text}</span>
    </div>
  );
}

export function ProgressDots({ runner }: { runner: PuzzleRunner }): ReactNode {
  const { done, total } = runner.progress;
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-2 w-6 rounded-full transition-colors ${i < done ? 'bg-good-500' : 'bg-ink-700'}`} />
      ))}
    </div>
  );
}
