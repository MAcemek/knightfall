import { useEffect, useState } from 'react';
import { TickerNumber } from '../../../shared/fx/index.ts';
import { Button, Modal } from '../../../shared/ui.tsx';
import { ShareButton } from './ShareButton.tsx';

function formatTime(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

/** "Daily complete!" card: the streak counts up from its old value, plus a share button. */
export function CelebrationModal({ open, onClose, streakBefore, streak, best, moves, timeMs, clean, share }: {
  open: boolean;
  onClose: () => void;
  streakBefore: number;
  streak: number;
  best: number;
  moves: number;
  timeMs: number;
  clean: boolean;
  share: string;
}) {
  const [counted, setCounted] = useState(false);
  useEffect(() => {
    if (!open) {
      setCounted(false);
      return;
    }
    const t = setTimeout(() => setCounted(true), 450);
    return () => clearTimeout(t);
  }, [open]);

  const shown = counted ? Math.max(streak, streakBefore) : streakBefore;
  return (
    <Modal open={open} onClose={onClose} className="text-center">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-ember-400">Daily complete</div>
      <h2 className="mt-1 text-3xl font-black tracking-tight">{clean ? 'Flawless!' : 'Solved!'}</h2>
      <div className="relative mx-auto mt-5 flex w-fit items-center gap-2 rounded-2xl bg-ink-950/60 px-6 py-4">
        <span key={counted ? 'lit' : 'dim'} className={`inline-block text-5xl ${counted ? 'animate-pop drop-shadow-[0_0_18px_rgb(255_154_31/0.7)]' : 'opacity-60'}`}>
          🔥
        </span>
        <div className="text-left">
          <div className="font-mono text-5xl font-black leading-none text-ember-400">
            <TickerNumber value={shown} duration={0.8} />
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-ink-400">day streak</div>
        </div>
      </div>
      <div className="mt-4 flex justify-center gap-2 text-sm text-ink-300">
        <span className="rounded-full bg-ink-800 px-3 py-1">
          {moves} move{moves === 1 ? '' : 's'}
        </span>
        <span className="rounded-full bg-ink-800 px-3 py-1">{formatTime(timeMs)}</span>
        <span className="rounded-full bg-ink-800 px-3 py-1">best {Math.max(best, streak)}</span>
      </div>
      <div className="mt-6 grid gap-2">
        <ShareButton text={share} size="lg" />
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-500">Come back after 00:00 UTC for the next one.</p>
    </Modal>
  );
}
