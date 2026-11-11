import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons, type IconName } from './ui.tsx';

/**
 * Tiny toast system. Call toast({...}) from anywhere (no hook needed); <ToastHost/> is mounted once in App.
 * Toasts are overlays: they never block input and dismiss themselves.
 */

export type ToastTone = 'ember' | 'good' | 'sky' | 'violet';

export interface ToastInput {
  title: string;
  body?: string;
  /** Key of `Icons` in shared/ui.tsx. */
  icon?: IconName;
  tone?: ToastTone;
  /** Auto-dismiss delay (default 4200 ms). */
  durationMs?: number;
  /** In-app path to open when the toast is clicked. */
  to?: string;
}

interface ToastItem extends ToastInput {
  id: number;
  leaving: boolean;
}

const MAX_VISIBLE = 4;
const LEAVE_MS = 180;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(next: ToastItem[]) {
  items = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot() {
  return items;
}

/** Show a toast. Returns its id (for dismissToast). */
export function toast(input: ToastInput): number {
  const id = nextId++;
  emit([...items, { ...input, id, leaving: false }].slice(-MAX_VISIBLE));
  setTimeout(() => dismissToast(id), input.durationMs ?? 4200);
  return id;
}

export function dismissToast(id: number): void {
  if (!items.some((t) => t.id === id && !t.leaving)) return;
  emit(items.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
  setTimeout(() => emit(items.filter((t) => t.id !== id)), LEAVE_MS);
}

const TONE: Record<ToastTone, { ring: string; icon: string }> = {
  ember: { ring: 'border-ember-500/50 shadow-[0_10px_40px_-10px_rgb(255_154_31/0.55)]', icon: 'bg-ember-500/15 text-ember-400' },
  good: { ring: 'border-good-500/50 shadow-[0_10px_40px_-10px_rgb(47_207_111/0.5)]', icon: 'bg-good-500/15 text-good-400' },
  sky: { ring: 'border-sky-400/50 shadow-[0_10px_40px_-10px_rgb(108_196_255/0.5)]', icon: 'bg-sky-400/15 text-sky-400' },
  violet: { ring: 'border-violet-400/50 shadow-[0_10px_40px_-10px_rgb(180_140_255/0.5)]', icon: 'bg-violet-400/15 text-violet-400' },
};

export function ToastHost() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const navigate = useNavigate();
  if (!list.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[95] flex flex-col items-center gap-2 px-3 lg:inset-x-auto lg:right-6 lg:top-6 lg:items-end lg:px-0" aria-live="polite">
      {list.map((t) => {
        const tone = TONE[t.tone ?? 'ember'];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              dismissToast(t.id);
              if (t.to) void navigate(t.to);
            }}
            className={`pointer-events-auto relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-2xl border bg-ink-850/95 px-3.5 py-3 text-left backdrop-blur ${tone.ring} ${t.leaving ? 'animate-toast-out' : 'animate-toast-in'}`}
          >
            <span className="kf-shine pointer-events-none absolute inset-0" aria-hidden />
            {t.icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}>{Icons[t.icon]('h-5 w-5')}</span>}
            <span className="min-w-0">
              <span className="block truncate text-sm font-extrabold text-ink-100">{t.title}</span>
              {t.body && <span className="block text-xs text-ink-300">{t.body}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
