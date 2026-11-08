import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Board } from '../../shared/Board/index.ts';
import { Icons } from '../../shared/ui.tsx';
import { themeLabel } from './logic.ts';

/* ---------------- Toasts ---------------- */

type ToastTone = 'good' | 'bad' | 'info';
interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

const ToastCtx = createContext<(text: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, tone: ToastTone = 'good') => {
    const id = ++idRef.current;
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[95] flex flex-col items-center gap-2 px-4 lg:bottom-8" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`flex animate-pop items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-2xl backdrop-blur ${
              t.tone === 'good'
                ? 'border-good-500/40 bg-ink-850/95 text-good-400'
                : t.tone === 'bad'
                  ? 'border-bad-500/40 bg-ink-850/95 text-bad-400'
                  : 'border-ink-600 bg-ink-850/95 text-ink-100'
            }`}
          >
            {t.tone === 'good' ? Icons.check('h-4 w-4') : t.tone === 'bad' ? Icons.x('h-4 w-4') : null}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- Keyboard shortcuts ---------------- */

/**
 * Bind keyboard shortcuts; ignored while typing in a field. Keys are case-sensitive `KeyboardEvent.key`
 * values ("f", "K", "Escape", "ArrowLeft"); Ctrl combos are written "ctrl+z".
 */
export function useHotkeys(map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.altKey || e.metaKey) return;
      const key = e.ctrlKey ? `ctrl+${e.key.toLowerCase()}` : e.key;
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-300">{children}</kbd>;
}

/* ---------------- Small presentational pieces ---------------- */

export function ThemeTag({ theme, className = '' }: { theme: string; className?: string }) {
  return <span className={`rounded-full bg-ink-700/80 px-2 py-0.5 text-[11px] font-semibold text-ink-200 ${className}`}>{themeLabel(theme)}</span>;
}

/** Static, non-interactive board thumbnail. */
export function MiniBoard({ fen, orientation = 'white', className = '' }: { fen: string; orientation?: 'white' | 'black'; className?: string }) {
  return (
    <div className={`pointer-events-none ${className}`}>
      <Board fen={fen} orientation={orientation} showCoords={false} />
    </div>
  );
}

export const STEPS = ['Set up position', 'Record solution', 'Details'] as const;

export function Stepper({ step, maxReached, onStep }: { step: number; maxReached: number; onStep: (i: number) => void }) {
  return (
    <ol className="mb-4 flex items-center gap-1.5 sm:gap-2">
      {STEPS.map((label, i) => {
        const active = i === step;
        const done = i < maxReached;
        const reachable = i <= maxReached;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onStep(i)}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left transition sm:px-3 ${
                active ? 'bg-ink-800 ring-1 ring-ember-500/60' : reachable ? 'hover:bg-ink-850' : 'opacity-50'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-black transition ${
                  active ? 'bg-ember-500 text-ink-950' : done ? 'bg-good-500 text-ink-950' : 'bg-ink-700 text-ink-300'
                }`}
              >
                {done && !active ? Icons.check('h-4 w-4') : i + 1}
              </span>
              <span className={`truncate text-xs font-bold sm:text-sm ${active ? 'text-ink-100' : 'text-ink-400'}`}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={`hidden h-0.5 w-4 shrink-0 rounded sm:block ${i < maxReached ? 'bg-good-500/70' : 'bg-ink-700'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Inline status line: green when ok, red with message otherwise. */
export function StatusLine({ error, okText }: { error: string | null; okText: string }) {
  return (
    <div
      key={error ?? 'ok'}
      className={`flex animate-pop items-start gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${
        error ? 'bg-bad-500/10 text-bad-400 ring-1 ring-bad-500/30' : 'bg-good-500/10 text-good-400 ring-1 ring-good-500/30'
      }`}
      role={error ? 'alert' : 'status'}
    >
      <span className="mt-px shrink-0">{error ? Icons.x('h-4 w-4') : Icons.check('h-4 w-4')}</span>
      <span>{error ?? okText}</span>
    </div>
  );
}

/** Fades + lifts its content in on mount (re-key to replay). */
export function FadeIn({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    ref.current?.animate?.(
      [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
