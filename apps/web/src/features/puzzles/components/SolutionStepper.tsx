import type { PuzzleRunner } from '../../../shared/PuzzlePlayer/index.ts';
import { Button, Icons } from '../../../shared/ui.tsx';
import { Kbd } from './Controls.tsx';

/**
 * ◀ Move 3 / 6 ▶ — steps through the finished line (board only, nothing is rated).
 * Always takes up its row (invisible until the puzzle is over) so the buttons below never jump.
 */
export function SolutionStepper({ runner }: { runner: PuzzleRunner }) {
  const steppable = runner.status === 'solved' || runner.status === 'solution';
  const backDisabled = !steppable || runner.review?.index === 0;
  const forwardDisabled = !steppable || (runner.review ? runner.review.index === runner.review.total : runner.status === 'solved');
  return (
    <div
      className={`flex h-9 items-center justify-between gap-2 rounded-xl bg-ink-900/60 px-1 transition-opacity duration-200 ${steppable ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      aria-hidden={!steppable}
    >
      <Button size="sm" variant="ghost" disabled={backDisabled} onClick={() => runner.stepBack()} title="Previous move (←)" aria-label="Previous move" tabIndex={steppable ? 0 : -1}>
        <span className="inline-block rotate-180">{Icons.next('h-4 w-4')}</span> <Kbd>←</Kbd>
      </Button>
      <span className="font-mono text-xs font-bold text-ink-300 tabular">
        {runner.review ? `Move ${runner.review.index} / ${runner.review.total}` : 'Step through the line'}
      </span>
      <Button size="sm" variant="ghost" disabled={forwardDisabled} onClick={() => runner.stepForward()} title="Next move (→)" aria-label="Next move" tabIndex={steppable ? 0 : -1}>
        <Kbd>→</Kbd> {Icons.next('h-4 w-4')}
      </Button>
    </div>
  );
}
