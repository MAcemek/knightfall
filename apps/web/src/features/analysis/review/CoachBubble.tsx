import type { ReactNode } from 'react';

/** Knightfall's coach: a round knight-head mascot (original artwork) next to a white speech bubble. */
export function KnightMascot({ size = 44, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={`shrink-0 ${className}`} aria-hidden>
      <circle cx="24" cy="24" r="23" fill="var(--color-ink-800)" stroke="var(--color-ember-500)" strokeWidth="2" />
      <path
        d="M15 37h19v-3c0-5-1.8-8.6-5-11 2.8-1.7 4-4.3 3.6-7.6L31 11l-3.6 2.4L24.6 9 21 12.6 13 20l1.6 3.4 4.4-1.6-3.4 5.2C14.8 29 14.4 33 15 37z"
        fill="var(--color-ember-400)"
        stroke="var(--color-ember-600)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="22.2" cy="18" r="1.7" fill="var(--color-ink-950)" />
      <path d="M17 36.5h17" stroke="var(--color-ember-600)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** Mascot + speech bubble. `right` is a small element pinned to the bubble's top-right corner (e.g. an eval chip). */
export function CoachBubble({ children, right, className = '' }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <KnightMascot />
      <div className="relative min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-ink-900 shadow-md">
        <span className="absolute -left-1.5 top-3 h-3 w-3 rotate-45 bg-white" aria-hidden />
        {right && <div className="absolute right-2 top-2">{right}</div>}
        <div className={`relative text-[15px] font-semibold leading-snug ${right ? 'pr-14' : ''}`}>{children}</div>
      </div>
    </div>
  );
}
