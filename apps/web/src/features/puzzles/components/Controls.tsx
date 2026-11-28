import type { ReactNode } from 'react';
import type { PuzzleRunner } from '../../../shared/PuzzlePlayer/index.ts';
import { Button, Icons } from '../../../shared/ui.tsx';
import { stepAbility } from './SolutionStepper.tsx';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="hidden rounded border border-current/30 px-1 font-mono text-[10px] leading-4 opacity-60 fine:inline-block">{children}</kbd>
  );
}

export interface ControlsProps {
  canHint: boolean;
  canRetry: boolean;
  canSolution: boolean;
  canNext?: boolean;
  /** Highlight Next (outcome reached). */
  nextReady?: boolean;
  loading?: boolean;
  onHint: () => void;
  onRetry: () => void;
  onSolution: () => void;
  /** Omit to hide the Next button (use `action` for a custom primary action). */
  onNext?: () => void;
  onFlip: () => void;
  action?: ReactNode;
  nextLabel?: string;
  extra?: ReactNode;
  /** Row rendered between the Hint/Retry/Solution buttons and the action/Next button (e.g. <SolutionStepper/>). */
  stepper?: ReactNode;
  /** Shows a "Keys ?" button that opens the shortcut overlay. */
  onHelp?: () => void;
  /** A <ControlDock/> is rendered under the board: below lg, hide the main buttons here and keep only flip/help/extra. */
  dock?: boolean;
}

/** Hint / Retry / Solution row, a big Next button that pulses when ready, and a flip toggle. */
export function Controls(p: ControlsProps) {
  return (
    <div className="space-y-3">
      <div className={p.dock ? 'max-lg:hidden' : ''}>
      <div className="grid grid-cols-3 gap-2">
        <Button size="sm" onClick={p.onHint} disabled={!p.canHint} title="Hint (H)">
          <span className="max-[400px]:hidden">{Icons.bulb('h-4 w-4')}</span> Hint <Kbd>H</Kbd>
        </Button>
        <Button size="sm" variant={p.canRetry ? 'danger' : 'secondary'} onClick={p.onRetry} disabled={!p.canRetry} title="Retry (R)">
          <span className="max-[400px]:hidden">{Icons.retry('h-4 w-4')}</span> Retry <Kbd>R</Kbd>
        </Button>
        <Button size="sm" onClick={p.onSolution} disabled={!p.canSolution} title="Show solution (S)">
          <span className="max-[400px]:hidden">{Icons.eye('h-4 w-4')}</span> Solution <Kbd>S</Kbd>
        </Button>
      </div>
      {p.stepper}
      {p.action}
      {p.onNext && (
        <div className="relative">
          {p.nextReady && !p.loading && <span className="pointer-events-none absolute inset-0 animate-ping rounded-xl bg-ember-400/30 [animation-duration:1.6s]" />}
          <Button
            size="lg"
            variant={p.nextReady ? 'primary' : 'secondary'}
            className="relative w-full"
            onClick={p.onNext}
            disabled={!p.canNext || p.loading}
            title="Next puzzle (Enter / Space)"
          >
            {p.loading ? 'Loading…' : p.nextLabel ?? 'Next puzzle'} {!p.loading && Icons.next('h-5 w-5')} <Kbd>↵</Kbd>
          </Button>
        </div>
      )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={p.onFlip} title="Flip board (F)">
            {Icons.flip('h-4 w-4')} Flip <Kbd>F</Kbd>
          </Button>
          {p.onHelp && (
            <span className="hidden fine:contents">
              <Button size="sm" variant="ghost" onClick={p.onHelp} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
                {Icons.help('h-4 w-4')} Keys <Kbd>?</Kbd>
              </Button>
            </span>
          )}
        </div>
        {p.extra}
      </div>
    </div>
  );
}

export interface ControlDockProps {
  runner: PuzzleRunner;
  canHint: boolean;
  canRetry: boolean;
  canSolution: boolean;
  canNext?: boolean;
  nextReady?: boolean;
  loading?: boolean;
  onHint: () => void;
  onRetry: () => void;
  onSolution: () => void;
  /** Omit to hide the big Next button (use `action` instead). */
  onNext?: () => void;
  nextLabel?: string;
  action?: ReactNode;
  /** Shown above the buttons (e.g. the "White to move" prompt). */
  prompt?: ReactNode;
}

/**
 * Phone-only control bar that sits directly under the board: step back / hint / retry / solution / step forward,
 * then the primary action. Every button is at least 44px tall. Hidden from lg up, where <Controls/> lives in the side panel.
 */
export function ControlDock(p: ControlDockProps) {
  const { backDisabled, forwardDisabled } = stepAbility(p.runner);
  return (
    <div className="mt-3 space-y-2 lg:hidden">
      {p.prompt}
      <div className="grid grid-cols-5 gap-1.5">
        <Button size="dock" disabled={backDisabled} onClick={() => p.runner.stepBack()} aria-label="Previous move">
          {Icons.chevLeft('h-5 w-5')} Back
        </Button>
        <Button size="dock" onClick={p.onHint} disabled={!p.canHint} aria-label="Hint">
          {Icons.bulb('h-5 w-5')} Hint
        </Button>
        <Button size="dock" variant={p.canRetry ? 'danger' : 'secondary'} onClick={p.onRetry} disabled={!p.canRetry} aria-label="Retry">
          {Icons.retry('h-5 w-5')} Retry
        </Button>
        <Button size="dock" onClick={p.onSolution} disabled={!p.canSolution} aria-label="Show solution">
          {Icons.eye('h-5 w-5')} Solution
        </Button>
        <Button size="dock" disabled={forwardDisabled} onClick={() => p.runner.stepForward()} aria-label="Next move">
          {Icons.chevRight('h-5 w-5')} Forward
        </Button>
      </div>
      {p.action}
      {p.onNext && (p.canNext || p.loading) && (
        <Button size="lg" variant={p.nextReady ? 'primary' : 'secondary'} className="h-12 w-full animate-rise" onClick={p.onNext} disabled={!p.canNext || p.loading}>
          {p.loading ? 'Loading…' : p.nextLabel ?? 'Next puzzle'} {!p.loading && Icons.next('h-5 w-5')}
        </Button>
      )}
    </div>
  );
}

/** Small accessible switch. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer select-none items-center gap-2 text-sm font-semibold text-ink-300">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[''] ${checked ? 'bg-ember-500' : 'bg-ink-700'}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}
