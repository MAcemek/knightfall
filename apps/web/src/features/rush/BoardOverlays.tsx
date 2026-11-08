import type { ReactNode } from 'react';
import { Button, Icons } from '../../shared/ui.tsx';
import type { EndReason } from './useRushGame.ts';

/** Big 3-2-1 over the board. */
export function CountdownOverlay({ count, label }: { count: number; label: string }) {
  return (
    <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-ink-950/70 backdrop-blur-[3px]">
      <div className="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-ink-300 sm:text-sm">{label}</div>
      <div className="relative flex items-center justify-center">
        <span key={`ring${count}`} className="absolute h-[34vmin] max-h-48 w-[34vmin] max-w-48 animate-pulse-ring rounded-full" />
        <span
          key={count}
          className="animate-pop font-mono text-[clamp(72px,24vmin,160px)] font-black leading-none text-ember-400 drop-shadow-[0_0_30px_rgb(255_154_31/0.55)]"
        >
          {count}
        </span>
      </div>
      <div className="mt-3 text-sm font-semibold text-ink-400">Get ready…</div>
    </div>
  );
}

/** "Go!" flash that fades out on its own and never blocks input. */
export function GoFlash() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center bg-ember-500/10 animate-[kf-glow_0.6s_ease-out_0.1s_both]">
      <span className="animate-pop text-[clamp(64px,20vmin,140px)] font-black italic tracking-tight text-ember-300 drop-shadow-[0_0_34px_rgb(255_154_31/0.8)]">
        GO!
      </span>
    </div>
  );
}

/** Green/red full-board flash on each result. */
export function ResultFlash({ kind, flashKey }: { kind: 'good' | 'bad'; flashKey: number }) {
  return (
    <div
      key={flashKey}
      className={`pointer-events-none absolute inset-0 z-30 animate-glow ${kind === 'good' ? 'bg-good-500/35 shadow-[inset_0_0_60px_rgb(47_207_111/0.8)]' : 'bg-bad-500/25 shadow-[inset_0_0_60px_rgb(240_72_72/0.8)]'}`}
    />
  );
}

const END_COPY: Record<EndReason, { title: string; tone: string; icon: (c?: string) => ReactNode }> = {
  time: { title: "Time's up!", tone: 'text-ember-300', icon: Icons.clock },
  strikes: { title: 'Three strikes!', tone: 'text-bad-400', icon: Icons.x },
  quit: { title: 'Run ended', tone: 'text-ink-200', icon: Icons.flame },
};

/** Freezes the board between the last move and the results screen. */
export function EndingOverlay({ reason }: { reason: EndReason }) {
  const c = END_COPY[reason];
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-ink-950/60 backdrop-blur-[2px] animate-[kf-glow_0.35s_ease-out_0.3s_reverse_both]">
      <div className={`flex animate-[kf-pop_0.4s_cubic-bezier(0.34,1.56,0.64,1)_0.35s_both] flex-col items-center gap-2 ${c.tone}`}>
        {c.icon('h-12 w-12 sm:h-16 sm:w-16 stroke-[2.5]')}
        <span className="text-[clamp(32px,9vmin,64px)] font-black tracking-tight drop-shadow-[0_4px_20px_rgb(0_0_0/0.6)]">{c.title}</span>
      </div>
    </div>
  );
}

export function LoadErrorOverlay({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-ink-950/80 p-6 text-center">
      <div className="text-lg font-bold text-bad-400">Couldn't load the next puzzle</div>
      <div className="max-w-xs text-sm text-ink-300">{message}</div>
      <Button variant="primary" onClick={onRetry}>
        {Icons.retry('h-4 w-4')} Try again
      </Button>
    </div>
  );
}
