import { useState, type ReactNode } from 'react';
import { Icons } from '../../../shared/ui.tsx';

function wasDismissed(id: string): boolean {
  try {
    return localStorage.getItem(`kf:tip:${id}`) === '1';
  } catch {
    return false;
  }
}

/** One-time onboarding hint. Dismissal is remembered per `id` on this device. */
export function TipCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(() => wasDismissed(id));
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(`kf:tip:${id}`, '1');
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="relative animate-rise rounded-2xl border border-sky-400/30 bg-sky-400/10 p-4 pr-10 text-sm text-ink-200">
      <div className="mb-1 flex items-center gap-2 font-extrabold text-sky-400">{Icons.bulb('h-4 w-4')} {title}</div>
      {children}
      <button type="button" onClick={dismiss} aria-label="Dismiss tip" className="absolute right-2 top-2 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100">
        {Icons.x('h-4 w-4')}
      </button>
    </div>
  );
}
