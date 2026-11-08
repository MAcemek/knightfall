import { useEffect, useRef, useState } from 'react';
import { animate } from 'motion';

/** A number that counts smoothly to its new value (score/rating tickers). */
export function TickerNumber({ value, duration = 0.6, className, format = (n: number) => String(Math.round(n)) }: {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    const controls = animate(from, value, { duration, ease: [0.2, 0.8, 0.2, 1], onUpdate: (v) => setShown(v) });
    return () => controls.stop();
  }, [value, duration]);
  return <span className={`tabular ${className ?? ''}`}>{format(shown)}</span>;
}

/**
 * Floating "+12" / "−8" that rises and fades. Re-trigger by changing `trigger`.
 * Render inside a `relative` container.
 */
export function FloatingDelta({ delta, trigger, className = '' }: { delta: number | null; trigger: unknown; className?: string }) {
  const [items, setItems] = useState<{ id: number; delta: number }[]>([]);
  const idRef = useRef(0);
  useEffect(() => {
    if (delta === null || trigger === undefined || trigger === null) return;
    const id = ++idRef.current;
    setItems((xs) => [...xs, { id, delta }]);
    const t = setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return (
    <span className={`pointer-events-none absolute inset-x-0 -top-2 flex justify-center ${className}`}>
      {items.map((it) => (
        <span
          key={it.id}
          className={`absolute animate-float-up font-mono text-lg font-bold ${it.delta >= 0 ? 'text-good-400' : 'text-bad-400'}`}
        >
          {it.delta >= 0 ? `+${it.delta}` : `−${Math.abs(it.delta)}`}
        </span>
      ))}
    </span>
  );
}

/** Returns [key, trigger]. Put `key` on an element with `animate-shake` to replay the shake. */
export function useReplayKey(): [number, () => void] {
  const [k, setK] = useState(0);
  return [k, () => setK((x) => x + 1)];
}
