import { memo } from 'react';
import { isLightSquare, screenSquares, squareName, type VisionColor } from './visionLogic.ts';

export type SquareMark = 'lit' | 'good' | 'bad' | 'reveal';

const MARK_CLASS: Record<SquareMark, string> = {
  lit: 'after:bg-ember-400/80',
  good: 'after:bg-good-500/75',
  bad: 'after:bg-bad-500/75',
  reveal: 'after:shadow-[inset_0_0_0_4px_var(--color-good-400)]',
};

/**
 * A plain board for the vision drills: no pieces except an optional knight and flag, no coordinates, every
 * square a tap target. Uses the player's board colours. Sized so board, prompt and answers fit one phone
 * screen.
 */
export const VisionBoard = memo(function VisionBoard({ orientation, marks, knight, flag, disabled, withAnswers = false, onTap }: {
  orientation: VisionColor;
  /** Leave room for the two rows of answer buttons under the board (Name the square). */
  withAnswers?: boolean;
  marks?: Partial<Record<number, SquareMark>>;
  knight?: number;
  flag?: number;
  disabled?: boolean;
  onTap: (sq: number) => void;
}) {
  return (
    <div
      className={`mx-auto w-full lg:max-w-[min(100%,34rem)] ${withAnswers ? 'max-w-[min(100%,max(15rem,calc(100dvh-27rem)))]' : 'max-w-[min(100%,max(16rem,calc(100dvh-23rem)))]'}`}
    >
      <div className="grid aspect-square grid-cols-8 overflow-hidden rounded-md shadow-[0_18px_50px_-12px_rgb(0_0_0/0.65)]" role="grid" aria-label="Board">
        {screenSquares(orientation).map((sq) => {
          const mark = marks?.[sq];
          return (
            <button
              key={sq}
              type="button"
              aria-label={squareName(sq)}
              disabled={disabled}
              onPointerDown={(e) => {
                // Pointer down, not click: a tap registers at once, which matters against the clock.
                if (e.button !== 0 || disabled) return;
                e.preventDefault();
                onTap(sq);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onTap(sq);
                }
              }}
              className={`relative aspect-square touch-manipulation select-none after:pointer-events-none after:absolute after:inset-0 after:transition-colors after:duration-150 after:content-[''] focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ember-400 disabled:cursor-default ${
                isLightSquare(sq) ? 'bg-[var(--color-sq-light)]' : 'bg-[var(--color-sq-dark)]'
              } ${mark ? MARK_CLASS[mark] : ''}`}
            >
              {flag === sq && knight !== sq && (
                <span className="absolute inset-[18%] z-[1] flex items-center justify-center rounded-full bg-ember-500 shadow-[0_0_14px_rgb(255_154_31/0.8)]" aria-hidden>
                  <svg viewBox="0 0 24 24" className="h-3/5 w-3/5 text-ink-950" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 21V4M6 4h11l-2 4 2 4H6" />
                  </svg>
                </span>
              )}
              {knight === sq && <img src="/pieces/wN.svg" alt="" draggable={false} className="pointer-events-none absolute inset-[6%] z-[2] h-[88%] w-[88%]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
});
