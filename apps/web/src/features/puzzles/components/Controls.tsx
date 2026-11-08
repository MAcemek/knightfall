import type { ReactNode } from 'react';
import { Button, Icons } from '../../../shared/ui.tsx';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="hidden rounded border border-current/30 px-1 font-mono text-[10px] leading-4 opacity-60 sm:inline-block">{children}</kbd>
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
}

/** Hint / Retry / Solution row, a big Next button that pulses when ready, and a flip toggle. */
export function Controls(p: ControlsProps) {
  return (
    <div className="space-y-3">
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
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={p.onFlip} title="Flip board (F)">
          {Icons.flip('h-4 w-4')} Flip <Kbd>F</Kbd>
        </Button>
        {p.extra}
      </div>
    </div>
  );
}

/** Small accessible switch. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-semibold text-ink-300">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-ember-500' : 'bg-ink-700'}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}
