import type { MoveClass } from '@knightfall/core';

/**
 * Knightfall's own move-class marks. Every glyph is plain geometry drawn here (no letters, no punctuation,
 * no check/cross/star, nothing traced from another site) in the app's colour tokens:
 *
 *   brilliant   two nested diamonds        violet-400
 *   great       one solid diamond          sky-400
 *   best        solid disc with a ring     good-500
 *   excellent   solid disc                 good-400
 *   good        open ring                  good-600
 *   book        three stacked bars         ember-300
 *   forced      bar with a wedge           ink-400
 *   inaccuracy  open triangle (down)       ember-400
 *   mistake     solid triangle (down)      ember-600
 *   miss        open square                bad-400
 *   blunder     solid square               bad-500
 */

export interface MoveClassMeta {
  label: string;
  /** CSS colour (a design token). */
  color: string;
  /** Tailwind text colour class for the same token. */
  text: string;
  /** One line for tooltips and the legend. */
  hint: string;
}

export const MOVE_CLASS_META: Record<MoveClass, MoveClassMeta> = {
  brilliant: { label: 'Brilliant', color: 'var(--color-violet-400)', text: 'text-violet-400', hint: 'A sound sacrifice' },
  great: { label: 'Great', color: 'var(--color-sky-400)', text: 'text-sky-400', hint: 'The only move that holds' },
  best: { label: 'Best', color: 'var(--color-good-500)', text: 'text-good-500', hint: "The engine's first choice" },
  excellent: { label: 'Excellent', color: 'var(--color-good-400)', text: 'text-good-400', hint: 'Almost as good as the best move' },
  good: { label: 'Good', color: 'var(--color-good-600)', text: 'text-good-600', hint: 'A solid move' },
  book: { label: 'Book', color: 'var(--color-ember-300)', text: 'text-ember-300', hint: 'Opening theory' },
  forced: { label: 'Forced', color: 'var(--color-ink-400)', text: 'text-ink-400', hint: 'The only legal move' },
  inaccuracy: { label: 'Inaccuracy', color: 'var(--color-ember-400)', text: 'text-ember-400', hint: 'A slightly better move existed' },
  mistake: { label: 'Mistake', color: 'var(--color-ember-600)', text: 'text-ember-600', hint: 'This cost a real part of the advantage' },
  miss: { label: 'Miss', color: 'var(--color-bad-400)', text: 'text-bad-400', hint: "The opponent's error went unpunished" },
  blunder: { label: 'Blunder', color: 'var(--color-bad-500)', text: 'text-bad-500', hint: 'This lost the thread of the game' },
};

/** Shapes on a 16x16 grid. `c` is the class colour. */
function shape(cls: MoveClass, c: string) {
  const stroke = { fill: 'none', stroke: c, strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  switch (cls) {
    case 'brilliant':
      return (
        <>
          <path d="M8 1 15 8 8 15 1 8Z" {...stroke} />
          <path d="M8 5 11 8 8 11 5 8Z" fill={c} />
        </>
      );
    case 'great':
      return <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill={c} />;
    case 'best':
      return (
        <>
          <circle cx="8" cy="8" r="6.5" {...stroke} />
          <circle cx="8" cy="8" r="3" fill={c} />
        </>
      );
    case 'excellent':
      return <circle cx="8" cy="8" r="6" fill={c} />;
    case 'good':
      return <circle cx="8" cy="8" r="5.5" {...stroke} />;
    case 'book':
      return <path d="M3 4h10M3 8h10M3 12h10" {...stroke} />;
    case 'forced':
      return <path d="M3 3v10M7 4l6 4-6 4Z" {...stroke} fill={c} />;
    case 'inaccuracy':
      return <path d="M2.5 3.5h11L8 13Z" {...stroke} />;
    case 'mistake':
      return <path d="M2 3h12L8 14Z" fill={c} />;
    case 'miss':
      return <rect x="3" y="3" width="10" height="10" rx="1.5" {...stroke} />;
    case 'blunder':
      return <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill={c} />;
  }
}

/** The mark for a move class. `size` is in CSS pixels; pass `title` to make it readable by screen readers. */
export function MoveGlyph({ cls, size = 14, className = '', title }: { cls: MoveClass; size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={`shrink-0 ${className}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {shape(cls, MOVE_CLASS_META[cls].color)}
    </svg>
  );
}

/** Glyph + label chip, e.g. for legends and the move header. */
export function MoveClassChip({ cls, className = '' }: { cls: MoveClass; className?: string }) {
  const m = MOVE_CLASS_META[cls];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-2.5 py-1 text-xs font-bold ${m.text} ${className}`} title={m.hint}>
      <MoveGlyph cls={cls} size={12} />
      {m.label}
    </span>
  );
}
