import type { PuzzleRunner } from '../../../shared/PuzzlePlayer/index.ts';
import { Button, Icons } from '../../../shared/ui.tsx';
import { Kbd } from './Controls.tsx';

/**
 * ◀ Move 3 / 6 ▶ — steps through the line (board only, nothing is rated): back to the opponent's last
 * move while solving, the whole line once the puzzle is over.
 * Always takes up its row (invisible when stepping is unavailable) so the buttons below never jump.
 */
export function stepAbility(runner: PuzzleRunner) {
  return { steppable: runner.steppable, backDisabled: !runner.canStepBack, forwardDisabled: !runner.canStepForward };
}

/** Phone Back/Forward pair (44px targets) for modes without a <ControlDock/>, e.g. Rush and Battle. */
export function PhoneStepper({ runner }: { runner: PuzzleRunner }) {
  const { steppable, backDisabled, forwardDisabled } = stepAbility(runner);
  return (
    <div
      className={`grid grid-cols-2 gap-1.5 lg:hidden ${steppable ? '' : 'pointer-events-none opacity-40'}`}
    >
      <Button size="dock" disabled={backDisabled} onClick={() => runner.stepBack()} aria-label="Previous move">
        {Icons.chevLeft('h-5 w-5')} Back
      </Button>
      <Button size="dock" disabled={forwardDisabled} onClick={() => runner.stepForward()} aria-label="Next move">
        {Icons.chevRight('h-5 w-5')} Forward
      </Button>
    </div>
  );
}

export function SolutionStepper({ runner }: { runner: PuzzleRunner }) {
  const { steppable, backDisabled, forwardDisabled } = stepAbility(runner);
  return (
    <div
      className={`flex h-9 items-center justify-between gap-2 rounded-xl bg-ink-900/60 px-1 transition-opacity duration-200 ${steppable ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      aria-hidden={!steppable}
    >
      <Button size="sm" variant="ghost" disabled={backDisabled} onClick={() => runner.stepBack()} title="Previous move (←)" aria-label="Previous move" tabIndex={steppable ? 0 : -1}>
        <span className="inline-block rotate-180">{Icons.next('h-4 w-4')}</span> <Kbd>←</Kbd>
      </Button>
      <span className="font-mono text-xs font-bold text-ink-300 tabular">
        {runner.review
          ? `Move ${runner.review.index} / ${runner.review.total}`
          : runner.status === 'player'
            ? 'See the last move'
            : 'Step through the line'}
      </span>
      <Button size="sm" variant="ghost" disabled={forwardDisabled} onClick={() => runner.stepForward()} title="Next move (→)" aria-label="Next move" tabIndex={steppable ? 0 : -1}>
        <Kbd>→</Kbd> {Icons.next('h-4 w-4')}
      </Button>
    </div>
  );
}
