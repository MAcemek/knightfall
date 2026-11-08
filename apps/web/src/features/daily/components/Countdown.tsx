import { useEffect, useRef, useState } from 'react';
import { utcDateKey } from '@knightfall/core';
import { Icons } from '../../../shared/ui.tsx';
import { formatHMS, msToNextUtcMidnight } from '../dailyLogic.ts';

/** Live hh:mm:ss to the next UTC midnight. Calls `onRollover(newKey)` when the UTC day changes. */
export function Countdown({ onRollover }: { onRollover: (dateKey: string) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const key = utcDateKey(new Date(now));
  const keyRef = useRef(key);
  const cb = useRef(onRollover);
  cb.current = onRollover;

  useEffect(() => {
    // Align ticks to the wall-clock second so the digits flip crisply.
    let interval: ReturnType<typeof setInterval> | undefined;
    const align = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), 1000);
    }, 1000 - (Date.now() % 1000));
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (key !== keyRef.current) {
      keyRef.current = key;
      cb.current(key);
    }
  }, [key]);

  const ms = msToNextUtcMidnight(now);
  const soon = ms < 60 * 60 * 1000;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-ink-850 px-3 py-2 ring-1 ring-ink-700/60" title="A new puzzle unlocks at 00:00 UTC">
      <span className={soon ? 'text-ember-400' : 'text-ink-400'}>{Icons.clock('h-4 w-4')}</span>
      <div className="leading-tight">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Next puzzle</div>
        <div className={`tabular font-mono text-sm font-bold ${soon ? 'text-ember-300' : 'text-ink-100'}`}>{formatHMS(ms)}</div>
      </div>
    </div>
  );
}
