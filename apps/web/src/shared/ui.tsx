import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { sfx } from './fx/sound.ts';

/** Small shared UI kit. Features should compose these so the app feels consistent. */

type Variant = 'primary' | 'secondary' | 'ghost' | 'good' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-ember-500 text-ink-950 shadow-[0_4px_0_0_var(--color-ember-600)] hover:bg-ember-400 active:translate-y-[3px] active:shadow-[0_1px_0_0_var(--color-ember-600)]',
  good: 'bg-good-500 text-ink-950 shadow-[0_4px_0_0_var(--color-good-600)] hover:bg-good-400 active:translate-y-[3px] active:shadow-[0_1px_0_0_var(--color-good-600)]',
  danger: 'bg-bad-500 text-white shadow-[0_4px_0_0_var(--color-bad-600)] hover:bg-bad-400 active:translate-y-[3px] active:shadow-[0_1px_0_0_var(--color-bad-600)]',
  secondary:
    'bg-ink-700 text-ink-100 shadow-[0_4px_0_0_var(--color-ink-800)] hover:bg-ink-600 active:translate-y-[3px] active:shadow-[0_1px_0_0_var(--color-ink-800)]',
  ghost: 'bg-transparent text-ink-300 hover:bg-ink-800 hover:text-ink-100',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'h-14 px-7 text-lg' : size === 'sm' ? 'h-9 px-3.5 text-sm' : 'h-11 px-5 text-base';
  return (
    <button
      {...rest}
      onClick={(e) => {
        sfx.click();
        onClick?.(e);
      }}
      className={`inline-flex select-none items-center justify-center gap-2 rounded-xl font-bold transition-[background,transform,box-shadow] duration-100 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 disabled:pointer-events-none disabled:opacity-40 ${sz} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl border border-ink-700/60 bg-ink-850 p-4 shadow-xl shadow-black/20 ${className}`}>{children}</div>;
}

export function Stat({ label, value, sub, accent = 'text-ink-100', className = '' }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl bg-ink-800/70 px-4 py-3 ${className}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-0.5 font-mono text-2xl font-bold ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full bg-ink-700 px-2.5 py-0.5 text-xs font-semibold text-ink-200 ${className}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, icon, right }: { title: string; subtitle?: string; icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon && <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-800 text-ember-400">{icon}</div>}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-ink-400">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

const MODAL_SIZES = { md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

/** Centered dialog. Closes on backdrop click and Escape when `onClose` is given. */
export function Modal({ open, onClose, children, className = '', size = 'md', label }: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  size?: keyof typeof MODAL_SIZES;
  /** Accessible name for the dialog. */
  label?: string;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !closeRef.current) return;
      // Capture phase + stopImmediatePropagation: Escape closes the dialog, not the page behind it.
      e.preventDefault();
      e.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex animate-fade-in items-center justify-center bg-ink-950/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`w-full ${MODAL_SIZES[size]} max-h-[calc(100dvh-2rem)] animate-pop overflow-y-auto rounded-2xl border border-ink-700 bg-ink-850 p-6 shadow-2xl ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** Keyboard key cap. */
export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <kbd className={`inline-flex min-w-6 items-center justify-center rounded-md border border-ink-600 bg-ink-800 px-1.5 font-mono text-xs font-bold leading-6 text-ink-200 ${className}`}>{children}</kbd>;
}

/** Accessible on/off switch with a label (and optional helper text) on the left. */
export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer select-none items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block font-semibold text-ink-100">{label}</span>
        {hint && <span className="block text-sm text-ink-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => {
          sfx.click();
          onChange(!checked);
        }}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${checked ? 'bg-ember-500' : 'bg-ink-700'}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

/** Segmented single-choice control (2–4 short options). */
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Accessible name for the group. */
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-ink-900 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => {
            if (o.id === value) return;
            sfx.click();
            onChange(o.id);
          }}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${o.id === value ? 'bg-ink-700 text-ember-400 shadow' : 'text-ink-400 hover:text-ink-100'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Friendly placeholder for a list/chart with no data yet. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex animate-rise flex-col items-center gap-2 rounded-2xl border border-dashed border-ink-700 px-6 py-8 text-center">
      {icon && <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-800 text-ember-400">{icon}</div>}
      <div className="text-lg font-extrabold">{title}</div>
      {children && <div className="max-w-sm text-sm text-ink-400">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Standard two-column game layout: board left, side panel right (stacks on mobile). */
export function GameLayout({ board, side, top }: { board: ReactNode; side: ReactNode; top?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 lg:flex-row lg:items-start">
      <div className="w-full min-w-0 lg:max-w-[min(78vh,720px)] lg:flex-1">
        {top}
        {board}
      </div>
      <div className="w-full lg:w-[340px] lg:shrink-0">{side}</div>
    </div>
  );
}

/* ---------- Icons (inline SVG, stroke-based) ---------- */
const I = ({ d, className = 'h-5 w-5' }: { d: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {d}
  </svg>
);
export const Icons = {
  home: (c?: string) => <I className={c} d={<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>} />,
  puzzle: (c?: string) => <I className={c} d={<path d="M10 3h4v3a2 2 0 104 0V3h3v7h-3a2 2 0 100 4h3v7h-7v-3a2 2 0 10-4 0v3H3v-7h3a2 2 0 100-4H3V3h7z" />} />,
  calendar: (c?: string) => <I className={c} d={<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>} />,
  bolt: (c?: string) => <I className={c} d={<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />} />,
  swords: (c?: string) => <I className={c} d={<><path d="M14.5 17.5L3 6V3h3l11.5 11.5" /><path d="M13 19l6-6M16 16l4 4M19 21l2-2" /><path d="M9.5 6.5L18 3h3v3l-3.5 8.5" /></>} />,
  pencil: (c?: string) => <I className={c} d={<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4L16.5 3.5z" /></>} />,
  flame: (c?: string) => <I className={c} d={<path d="M12 22c4 0 7-3 7-7 0-5-5-8-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z" />} />,
  volume: (c?: string) => <I className={c} d={<><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></>} />,
  mute: (c?: string) => <I className={c} d={<><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></>} />,
  bulb: (c?: string) => <I className={c} d={<><path d="M9 18h6M10 22h4" /><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z" /></>} />,
  retry: (c?: string) => <I className={c} d={<><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8" /><path d="M3 3v5h5" /></>} />,
  next: (c?: string) => <I className={c} d={<path d="M5 12h14M13 6l6 6-6 6" />} />,
  eye: (c?: string) => <I className={c} d={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>} />,
  flip: (c?: string) => <I className={c} d={<><path d="M7 4v16M7 4L3 8M7 4l4 4" /><path d="M17 20V4M17 20l-4-4M17 20l4-4" /></>} />,
  trophy: (c?: string) => <I className={c} d={<><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" /><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3" /></>} />,
  x: (c?: string) => <I className={c} d={<path d="M18 6L6 18M6 6l12 12" />} />,
  check: (c?: string) => <I className={c} d={<path d="M20 6L9 17l-5-5" />} />,
  share: (c?: string) => <I className={c} d={<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>} />,
  clock: (c?: string) => <I className={c} d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />,
  sliders: (c?: string) => <I className={c} d={<><path d="M4 6h8M20 6h-2M4 12h2M12 12h8M4 18h10M20 18h0" /><circle cx="15" cy="6" r="2.5" /><circle cx="9" cy="12" r="2.5" /><circle cx="17" cy="18" r="2.5" /></>} />,
  chart: (c?: string) => <I className={c} d={<><path d="M4 4v16h16" /><path d="M7.5 15l4-5 3 3 5-7" /></>} />,
  target: (c?: string) => <I className={c} d={<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>} />,
  layers: (c?: string) => <I className={c} d={<><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>} />,
  help: (c?: string) => <I className={c} d={<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01" /></>} />,
  lock: (c?: string) => <I className={c} d={<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>} />,
};

/** Any key of `Icons` (used by toasts and achievements to reference an icon by name). */
export type IconName = keyof typeof Icons;
