import { useEffect, useState } from 'react';
import { FloatingDelta, TickerNumber } from '../../../shared/fx/index.ts';
import type { StreakState } from '../../../shared/db.ts';
import { PROVISIONAL_RD } from '../logic.ts';
import type { StreakEvent } from '../useRatedSession.ts';

export interface RatingCardProps {
  rating: number | undefined;
  rd: number | undefined;
  streak: StreakState | undefined;
  /** Delta to float above the rating (null = none). */
  delta: number | null;
  deltaTrigger: unknown;
  streakEvent: StreakEvent | null;
  compact?: boolean;
}

/** Big rating ticker with a floating ±delta, plus the solve-streak flame. */
export function RatingCard({ rating, rd, streak, delta, deltaTrigger, streakEvent, compact = false }: RatingCardProps) {
  const provisional = rd !== undefined && rd > PROVISIONAL_RD;
  const ratingTone = delta === null ? 'text-ink-100' : delta > 0 ? 'text-good-400' : delta < 0 ? 'text-bad-400' : 'text-ink-100';
  // Briefly tint the rating after a change, then settle back to neutral.
  const [tinted, setTinted] = useState(false);
  useEffect(() => {
    if (deltaTrigger === undefined || deltaTrigger === null || delta === null || delta === 0) return;
    setTinted(true);
    const t = setTimeout(() => setTinted(false), 1400);
    return () => clearTimeout(t);
  }, [deltaTrigger, delta]);

  if (compact) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-ink-700/60 bg-ink-850 px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Rating</span>
          <span className="relative font-mono text-2xl font-black" data-rating-number>
            {rating === undefined ? '—' : <TickerNumber value={rating} className={`transition-colors duration-500 ${tinted ? ratingTone : 'text-ink-100'}`} />}
            <FloatingDelta delta={delta} trigger={deltaTrigger} className="text-base" />
          </span>
          {provisional && <span className="text-xs text-ink-500">?</span>}
        </div>
        <StreakFlame streak={streak} event={streakEvent} size="sm" />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink-700/60 bg-gradient-to-br from-ink-800 to-ink-850 p-4 shadow-xl shadow-black/20">
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-ember-500/10 blur-2xl" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Puzzle rating</div>
          <div className="relative mt-1 inline-block font-mono text-5xl font-black leading-none" data-rating-number>
            {rating === undefined ? '—' : <TickerNumber value={rating} duration={0.9} className={`transition-colors duration-500 ${tinted ? ratingTone : 'text-ink-100'}`} />}
            <FloatingDelta delta={delta} trigger={deltaTrigger} className="-top-5 text-2xl" />
          </div>
          <div className="mt-2 text-xs text-ink-500">
            {rating === undefined ? ' ' : provisional ? 'Provisional · settles after a few more puzzles' : `±${Math.round(rd ?? 0)} confidence`}
          </div>
        </div>
        <StreakFlame streak={streak} event={streakEvent} size="lg" />
      </div>
    </div>
  );
}

/** 🔥 counter: greyed at 0, pops on every increment, shakes when broken. */
export function StreakFlame({ streak, event, size }: { streak: StreakState | undefined; event: StreakEvent | null; size: 'sm' | 'lg' }) {
  const current = streak?.current ?? 0;
  const best = streak?.best ?? 0;
  const [bestFlash, setBestFlash] = useState(0);
  useEffect(() => {
    if (!event?.newBest) return;
    setBestFlash(event.key);
    const t = setTimeout(() => setBestFlash(0), 2600);
    return () => clearTimeout(t);
  }, [event]);
  const anim = event?.incremented ? 'animate-pop' : event?.broken ? 'animate-shake' : '';
  const lit = current > 0;

  if (size === 'sm') {
    return (
      <div className="relative flex items-center gap-1.5" data-streak-flame>
        <span key={`f${event?.key ?? 0}`} className={`text-xl inline-block ${anim} ${lit ? '' : 'opacity-40 grayscale'}`}>
          🔥
        </span>
        <span key={`n${event?.key ?? 0}`} className={`font-mono text-xl font-black inline-block ${anim} ${lit ? 'text-ember-400' : 'text-ink-500'}`}>
          {current}
        </span>
        {bestFlash > 0 && <span className="absolute -top-5 right-0 animate-float-up whitespace-nowrap text-xs font-black text-ember-300">New best!</span>}
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center rounded-xl bg-ink-950/50 px-3.5 py-2.5" data-streak-flame>
      <div className="flex items-center gap-1">
        <span
          key={`f${event?.key ?? 0}`}
          className={`text-3xl drop-shadow-[0_0_12px_rgb(255_154_31/0.55)] inline-block ${anim} ${lit ? '' : 'opacity-40 grayscale drop-shadow-none'}`}
        >
          🔥
        </span>
        <span key={`n${event?.key ?? 0}`} className={`font-mono text-3xl font-black inline-block ${anim} ${lit ? 'text-ember-400' : 'text-ink-500'}`}>
          {current}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Streak · best {best}</div>
      {bestFlash > 0 && (
        <span key={bestFlash} className="absolute -top-3 left-1/2 -translate-x-1/2 animate-pop whitespace-nowrap rounded-full bg-ember-500 px-2 py-0.5 text-[11px] font-black text-ink-950 shadow-lg">
          New best!
        </span>
      )}
    </div>
  );
}
