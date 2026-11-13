import type { MoveClass } from '@knightfall/core';

/**
 * Knightfall's own move-class marks: a disc in the class colour with a white symbol drawn here as plain
 * paths (nothing traced from another site). The symbols are bold so they stay legible at 14-24px.
 */

export interface MoveClassMeta {
  label: string;
  /** CSS colour of the class (also the disc fill). */
  color: string;
  /** Tailwind text colour class for the same colour. */
  text: string;
  /** One line for tooltips and the legend. */
  hint: string;
}

export const MOVE_CLASS_META: Record<MoveClass, MoveClassMeta> = {
  brilliant: { label: 'Brilliant', color: '#1baaa6', text: 'text-[#1baaa6]', hint: 'A sound sacrifice' },
  great: { label: 'Great', color: '#5b8baf', text: 'text-[#5b8baf]', hint: 'The only move that holds' },
  best: { label: 'Best', color: '#98bc49', text: 'text-[#98bc49]', hint: "The engine's first choice" },
  excellent: { label: 'Excellent', color: '#98bc49', text: 'text-[#98bc49]', hint: 'Almost as good as the best move' },
  good: { label: 'Good', color: '#97af8b', text: 'text-[#97af8b]', hint: 'A solid move' },
  book: { label: 'Book', color: '#a88764', text: 'text-[#a88764]', hint: 'Opening theory' },
  forced: { label: 'Forced', color: '#97af8b', text: 'text-[#97af8b]', hint: 'The only legal move' },
  inaccuracy: { label: 'Inaccuracy', color: '#f4bf44', text: 'text-[#f4bf44]', hint: 'A slightly better move existed' },
  mistake: { label: 'Mistake', color: '#e28c28', text: 'text-[#e28c28]', hint: 'This cost a real part of the advantage' },
  miss: { label: 'Miss', color: '#ee6b55', text: 'text-[#ee6b55]', hint: "The opponent's error went unpunished" },
  blunder: { label: 'Blunder', color: '#c93230', text: 'text-[#c93230]', hint: 'This lost the thread of the game' },
};

/** Row order of the summary count table. */
export const REPORT_TABLE_CLASSES: readonly MoveClass[] = [
  'brilliant', 'great', 'book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder',
];

const W = '#fff';
const stroke = (w: number) => ({ fill: 'none', stroke: W, strokeWidth: w, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

/** "!" centred on x (24-unit grid). */
function bang(x: number, key = 'b') {
  return (
    <g key={key}>
      <path d={`M${x} 5.5V14`} {...stroke(3.2)} />
      <circle cx={x} cy="18.4" r="1.9" fill={W} />
    </g>
  );
}

/** "?" centred on x, scaled by s around its own centre. */
function query(x: number, s = 1, key = 'q') {
  return (
    <g key={key} transform={`translate(${x} 12) scale(${s}) translate(-12 -12)`}>
      <path d="M8.4 9.2a3.6 3.6 0 1 1 5.6 3c-1.4.9-2 1.7-2 3.2" {...stroke(3.2 / s)} />
      <circle cx="12" cy="19" r={1.9 / s} fill={W} />
    </g>
  );
}

function symbol(cls: MoveClass) {
  switch (cls) {
    case 'brilliant':
      return [bang(8.2, 'a'), bang(15.8, 'b')];
    case 'great':
      return bang(12);
    case 'best':
      return <path d="M12 4.6l2.2 4.7 5.1.6-3.8 3.5 1 5.1-4.5-2.6-4.5 2.6 1-5.1-3.8-3.5 5.1-.6z" fill={W} stroke={W} strokeWidth="1" strokeLinejoin="round" />;
    case 'excellent':
      return (
        <>
          <rect x="4.6" y="10.6" width="3.6" height="8.4" rx="1" fill={W} />
          <path d="M10 10.8l2.9-5.6c1.3-.3 2.4.7 2.1 2l-.5 2.6h4c1.1 0 1.9 1 1.7 2l-.9 5.2c-.2 1-.9 1.5-1.8 1.5H10z" fill={W} stroke={W} strokeWidth="0.8" strokeLinejoin="round" />
        </>
      );
    case 'good':
      return <path d="M6.2 12.6l4 4 7.6-8.6" {...stroke(3.2)} />;
    case 'book':
      return (
        <>
          <path d="M11.4 7.6C9.6 6.3 7.2 5.9 4.8 6.3v10.9c2.4-.4 4.8 0 6.6 1.3z" fill={W} />
          <path d="M12.6 7.6c1.8-1.3 4.2-1.7 6.6-1.3v10.9c-2.4-.4-4.8 0-6.6 1.3z" fill={W} />
        </>
      );
    case 'forced':
      return <path d="M5.5 12h12M12.5 6.5l5.5 5.5-5.5 5.5" {...stroke(3.2)} />;
    case 'inaccuracy':
      return [query(7.6, 0.8, 'q'), bang(17, 'b')];
    case 'mistake':
      return query(12, 1);
    case 'miss':
      return <path d="M7.6 7.6l8.8 8.8M16.4 7.6l-8.8 8.8" {...stroke(3.4)} />;
    case 'blunder':
      return [query(7.2, 0.8, 'a'), query(16.8, 0.8, 'b')];
  }
}

/** The mark for a move class. `size` is in CSS pixels; pass `title` to make it readable by screen readers. */
export function MoveGlyph({ cls, size = 14, className = '', title }: { cls: MoveClass; size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={`shrink-0 ${className}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <circle cx="12" cy="12" r="12" fill={MOVE_CLASS_META[cls].color} />
      {symbol(cls)}
    </svg>
  );
}

/** Glyph + label chip, e.g. for legends and the move header. */
export function MoveClassChip({ cls, className = '' }: { cls: MoveClass; className?: string }) {
  const m = MOVE_CLASS_META[cls];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-2.5 py-1 text-xs font-bold ${m.text} ${className}`} title={m.hint}>
      <MoveGlyph cls={cls} size={14} />
      {m.label}
    </span>
  );
}
