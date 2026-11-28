import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Icons } from '../../shared/ui.tsx';

const ROWS = [
  { to: '/daily', title: 'Daily', blurb: "One hand-picked puzzle a day", icon: Icons.calendar },
  { to: '/rush', title: 'Rush', blurb: 'Beat the clock, three strikes', icon: Icons.bolt },
  { to: '/custom', title: 'Custom', blurb: 'Set up a position and share a link', icon: Icons.pencil },
  { to: '/analysis', title: 'Review', blurb: 'Analyse your games with the engine', icon: Icons.search },
  { to: '/coach', title: 'Coach', blurb: 'A 12-week plan, a short list each day', icon: Icons.bulb },
  { to: '/stats', title: 'Stats', blurb: 'Rating curve, strengths and unlocks', icon: Icons.chart },
  { to: '/settings', title: 'Settings', blurb: 'Sound, goals, backup and more', icon: Icons.sliders },
] as const;

/** Phone bottom sheet behind the "More" tab. Focus moves in on open and back to `returnFocus` on close. */
export function MoreSheet({ open, onClose, returnFocus }: { open: boolean; onClose: () => void; returnFocus: React.RefObject<HTMLElement | null> }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const firstRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    const back = returnFocus.current;
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      back?.focus();
    };
  }, [open, returnFocus]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex animate-fade-in items-end bg-ink-950/75 backdrop-blur-sm lg:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More"
        className="max-h-[85dvh] w-full animate-dialog-in overflow-y-auto overscroll-contain rounded-t-3xl border-t border-ink-700 bg-ink-850 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink-600" />
        <ul className="space-y-1">
          {ROWS.map((r, i) => (
            <li key={r.to}>
              <Link
                ref={i === 0 ? firstRef : undefined}
                to={r.to}
                onClick={onClose}
                className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-ink-800 active:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-950/60 text-ember-400">{r.icon('h-5 w-5')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold leading-tight">{r.title}</span>
                  <span className="block truncate text-sm text-ink-400">{r.blurb}</span>
                </span>
                {Icons.next('h-4 w-4 shrink-0 text-ink-500')}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
