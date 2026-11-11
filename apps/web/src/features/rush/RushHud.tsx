import { useEffect, useRef } from 'react';
import { animate } from 'motion';
import { burstAt, FloatingDelta, PALETTES, TickerNumber } from '../../shared/fx/index.ts';
import { Icons } from '../../shared/ui.tsx';
import { motionOff } from '../../shared/settings.ts';
import { COMBO_BADGE_AT, DANGER_MS, formatClock, MAX_STRIKES, MILESTONE_EVERY, type RushModeConfig, type RunCore } from './rushLogic.ts';

/** Clock + draining bar (or survival stopwatch). */
function Clock({ cfg, remainingMs, elapsedMs, live }: { cfg: RushModeConfig; remainingMs: number; elapsedMs: number; live: boolean }) {
  if (!cfg.durationMs) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-400">
          {Icons.flame('h-3.5 w-3.5 text-ember-400')} Survival
        </div>
        <div className="font-mono text-2xl font-bold text-ink-200 tabular sm:text-3xl">{formatClock(elapsedMs, 'up')}</div>
      </div>
    );
  }
  return <Countdown cfg={cfg} remainingMs={remainingMs} live={live} />;
}

function Countdown({ cfg, remainingMs, live }: { cfg: RushModeConfig; remainingMs: number; live: boolean }) {
  const danger = live && remainingMs <= DANGER_MS;
  const sec = Math.ceil(remainingMs / 1000);
  const ref = useRef<HTMLDivElement>(null);
  // Heartbeat pulse on every second of the final countdown.
  useEffect(() => {
    if (!danger || !ref.current || motionOff()) return;
    const c = animate(ref.current, { scale: [1.22, 1] }, { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] });
    return () => c.stop();
  }, [danger, sec]);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-400">
        {Icons.clock('h-3.5 w-3.5')} {cfg.short}
      </div>
      <div
        ref={ref}
        className={`origin-left font-mono text-3xl font-black tabular transition-colors sm:text-4xl ${danger ? 'text-bad-400 drop-shadow-[0_0_12px_rgb(240_72_72/0.6)]' : 'text-ink-100'}`}
      >
        {formatClock(remainingMs)}
      </div>
    </div>
  );
}

/** Three ✗ slots that fill red with a pop on every strike. */
export function StrikeSlots({ strikes, shakeKey, size = 'md' }: { strikes: number; shakeKey: number; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8 sm:h-10 sm:w-10';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5 sm:h-6 sm:w-6';
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!shakeKey || !el) return;
    // Restart the shake animation without remounting the slots (so only the new strike pops).
    el.classList.remove('animate-shake');
    void el.offsetWidth;
    el.classList.add('animate-shake');
  }, [shakeKey]);
  return (
    <div ref={ref} className="flex gap-1.5" aria-label={`${strikes} of ${MAX_STRIKES} strikes`}>
      {Array.from({ length: MAX_STRIKES }, (_, i) => {
        const filled = i < strikes;
        return (
          <div
            key={`${i}-${filled}`}
            className={`flex ${box} items-center justify-center rounded-lg border-2 ${
              filled
                ? 'animate-pop border-bad-400 bg-bad-500 text-white shadow-[0_0_16px_-2px_rgb(240_72_72/0.8)]'
                : 'border-ink-700 bg-ink-900/60 text-ink-700'
            }`}
          >
            {Icons.x(`${icon} stroke-[3]`)}
          </div>
        );
      })}
    </div>
  );
}

/** Combo chip: muted ×N while building, glowing ember badge from COMBO_BADGE_AT. */
export function ComboBadge({ combo }: { combo: number }) {
  if (combo < 2) return null;
  if (combo < COMBO_BADGE_AT) {
    return <span className="font-mono text-sm font-bold text-ink-400 tabular">×{combo}</span>;
  }
  return (
    <span
      key={combo}
      className="inline-flex animate-pop items-center gap-0.5 rounded-full bg-gradient-to-br from-ember-400 to-ember-600 px-2.5 py-0.5 font-mono text-sm font-black text-ink-950 shadow-[0_0_18px_2px_rgb(255_154_31/0.55)] tabular"
    >
      {Icons.flame('h-3.5 w-3.5')}×{combo}
    </span>
  );
}

/** Five pips that fill toward the next combo milestone (every MILESTONE_EVERY solves in a row). */
export function ComboMeter({ combo }: { combo: number }) {
  const filled = combo === 0 ? 0 : ((combo - 1) % MILESTONE_EVERY) + 1;
  const full = filled === MILESTONE_EVERY;
  return (
    <div key={full ? `full-${combo}` : 'meter'} className={`flex gap-1 ${full ? 'animate-pop' : ''}`} role="img" aria-label={`Combo ${combo}, ${filled} of ${MILESTONE_EVERY} to the next bonus burst`}>
      {Array.from({ length: MILESTONE_EVERY }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-4 rounded-full transition-colors duration-150 sm:w-5 ${i < filled ? (full ? 'bg-ember-300 shadow-[0_0_10px_rgb(255_207_138/0.9)]' : 'bg-ember-500 shadow-[0_0_8px_rgb(255_154_31/0.6)]') : 'bg-ink-700'}`}
        />
      ))}
    </div>
  );
}

export function RushHud({
  cfg,
  core,
  remainingMs,
  elapsedMs,
  live,
  solveKey,
  milestoneKey,
  strikeKey,
}: {
  cfg: RushModeConfig;
  core: RunCore;
  remainingMs: number;
  elapsedMs: number;
  live: boolean;
  solveKey: number;
  milestoneKey: number;
  strikeKey: number;
}) {
  const scoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (solveKey) burstAt(scoreRef.current, { count: 12, colors: PALETTES.good, power: 4.5, size: 4, life: 38, gravity: 0.12 });
  }, [solveKey]);
  useEffect(() => {
    if (milestoneKey) burstAt(scoreRef.current, { count: 46, colors: PALETTES.ember, power: 9, size: 9, shape: 'star', life: 70 });
  }, [milestoneKey]);

  const pct = cfg.durationMs ? Math.max(0, Math.min(100, (remainingMs / cfg.durationMs) * 100)) : 100;
  const danger = live && cfg.durationMs !== null && remainingMs <= DANGER_MS;

  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-ink-700/60 bg-ink-850 shadow-xl shadow-black/20">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2.5 sm:px-4">
        <Clock cfg={cfg} remainingMs={remainingMs} elapsedMs={elapsedMs} live={live} />

        <div className="relative flex flex-col items-center" ref={scoreRef}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Score</div>
          <div className="relative flex items-center gap-2">
            <TickerNumber
              value={core.score}
              duration={0.35}
              className={`font-mono text-4xl font-black leading-none sm:text-5xl ${core.combo >= COMBO_BADGE_AT ? 'text-ember-400 drop-shadow-[0_0_14px_rgb(255_154_31/0.5)]' : 'text-ink-100'}`}
            />
            <FloatingDelta delta={solveKey ? 1 : null} trigger={solveKey || null} />
          </div>
          <div className="mt-1 flex h-6 items-center">
            <ComboBadge combo={core.combo} />
          </div>
          <div className="mt-1">
            <ComboMeter combo={core.combo} />
          </div>
        </div>

        <div className="flex justify-end">
          <StrikeSlots strikes={core.strikes} shakeKey={strikeKey} />
        </div>
      </div>

      {cfg.durationMs ? (
        <div className="h-1.5 w-full bg-ink-900">
          <div
            className={`h-full transition-[width] duration-100 ease-linear ${danger ? 'bg-bad-500 shadow-[0_0_10px_rgb(240_72_72/0.8)]' : 'bg-gradient-to-r from-ember-600 to-ember-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="h-1.5 w-full bg-gradient-to-r from-ember-600/40 via-ember-400/60 to-ember-600/40" />
      )}
    </div>
  );
}
