import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { PlayerInfo } from '@knightfall/core';
import { burst, PALETTES, sfx } from '../../shared/fx/index.ts';
import { Icons } from '../../shared/ui.tsx';

/**
 * Full-screen "You vs Opponent" intro: cards slide in from both sides, then a 3-2-1-GO
 * countdown synced to the server's startsAt. Calls onDone shortly after GO.
 */
export function MatchIntro({ me, opponent, startsAt, serverNow, onDone }: {
  me: PlayerInfo;
  opponent: PlayerInfo;
  /** Server epoch ms (0 until the server sent 'start'). */
  startsAt: number;
  serverNow: () => number;
  onDone: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  const goRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!startsAt) return;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const left = startsAt - serverNow();
      const n = left > 0 ? Math.min(3, Math.ceil(left / 1000)) : 0;
      if (n === last.current) return;
      last.current = n;
      setCount(n);
      if (n > 0) sfx.countdown();
      else {
        sfx.go();
        requestAnimationFrame(() => {
          const r = goRef.current?.getBoundingClientRect();
          if (r) burst(r.left + r.width / 2, r.top + r.height / 2, { colors: PALETTES.ember, count: 40, power: 9 });
        });
        doneTimer = setTimeout(() => onDoneRef.current(), 450);
      }
    };
    tick();
    const t = setInterval(tick, 50);
    return () => {
      clearInterval(t);
      if (doneTimer) clearTimeout(doneTimer);
    };
  }, [startsAt, serverNow]);

  // count === 0 means GO is on screen.
  const finished = count === 0;

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-ink-950/85 px-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      role="dialog"
      aria-label="Battle starting"
    >
      <div className="pointer-events-none absolute left-0 top-1/2 h-[60vh] w-1/2 -translate-y-1/2 bg-gradient-to-r from-ember-500/15 to-transparent" />
      <div className="pointer-events-none absolute right-0 top-1/2 h-[60vh] w-1/2 -translate-y-1/2 bg-gradient-to-l from-sky-400/15 to-transparent" />

      <div className="relative flex w-full max-w-3xl flex-col items-center gap-6 sm:flex-row sm:gap-4">
        <motion.div
          className="w-full sm:flex-1"
          initial={{ x: '-120vw', rotate: -6 }}
          animate={{ x: 0, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 170, damping: 19 }}
        >
          <PlayerCard info={me} label="You" accent="ember" />
        </motion.div>

        <div className="flex h-24 w-24 shrink-0 items-center justify-center">
          {count === null ? (
            <motion.div
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.25 }}
              className="text-4xl font-black italic text-ink-300"
            >
              VS
            </motion.div>
          ) : (
            <motion.div
              key={count}
              ref={finished ? goRef : undefined}
              initial={{ scale: 2.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 18 }}
              className={`font-mono font-black tabular ${finished ? 'text-5xl text-good-400 drop-shadow-[0_0_24px_rgb(47_207_111/0.6)]' : 'text-7xl text-ember-400 drop-shadow-[0_0_24px_rgb(255_154_31/0.5)]'}`}
            >
              {finished ? 'GO!' : count}
            </motion.div>
          )}
        </div>

        <motion.div
          className="w-full sm:flex-1"
          initial={{ x: '120vw', rotate: 6 }}
          animate={{ x: 0, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 170, damping: 19, delay: 0.08 }}
        >
          <PlayerCard info={opponent} label="Opponent" accent="sky" />
        </motion.div>
      </div>

      <motion.div
        className="absolute bottom-[12%] text-center text-sm font-semibold text-ink-400"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        {startsAt ? 'Same puzzles. Three minutes. Three strikes.' : 'Get ready…'}
      </motion.div>
    </motion.div>
  );
}

function PlayerCard({ info, label, accent }: { info: PlayerInfo; label: string; accent: 'ember' | 'sky' }) {
  const isBot = info.name.startsWith('Bot');
  const ring = accent === 'ember' ? 'ring-ember-500/50 shadow-[0_0_50px_rgb(255_154_31/0.18)]' : 'ring-sky-400/50 shadow-[0_0_50px_rgb(108_196_255/0.18)]';
  const badge = accent === 'ember' ? 'from-ember-400 to-ember-600' : 'from-sky-400 to-violet-400';
  const initials = info.name.replace(/^Bot · /, '').slice(0, 2).toUpperCase();
  return (
    <div className={`flex items-center gap-4 rounded-2xl bg-ink-850 p-4 ring-2 ${ring} ${accent === 'sky' ? 'sm:flex-row-reverse sm:text-right' : ''}`}>
      <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${badge} text-2xl font-black text-ink-950`}>
        {isBot ? Icons.bolt('h-8 w-8') : initials}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-widest text-ink-400">{label}</div>
        <div className="truncate text-xl font-extrabold">{info.name}</div>
        <div className="font-mono text-lg font-bold text-ink-300">{info.rating}</div>
      </div>
    </div>
  );
}
