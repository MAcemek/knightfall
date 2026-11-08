import { useEffect, useState, type ReactNode } from 'react';
import { PuzzleBoard, type PuzzleRunner } from '../../../shared/PuzzlePlayer/index.ts';
import { burstAt, PALETTES } from '../../../shared/fx/index.ts';

export type BoardGlow = 'good' | 'bad' | null;

const GLOW_SHADOW: Record<'good' | 'bad', string> = {
  good: '0 0 0 3px rgb(47 207 111 / 0.9), 0 0 42px -4px rgb(47 207 111 / 0.55)',
  bad: '0 0 0 3px rgb(240 72 72 / 0.85), 0 0 42px -4px rgb(240 72 72 / 0.5)',
};
const FLASH: Record<'good' | 'bad', string> = {
  good: 'radial-gradient(circle at center, rgb(91 227 142 / 0.35), transparent 70%)',
  bad: 'radial-gradient(circle at center, rgb(255 122 122 / 0.3), transparent 70%)',
};

/**
 * Board wired to a puzzle runner, plus: flip support, a green/red glow ring on the outcome,
 * and a one-shot flash overlay. Shared by the rated trainer and the daily puzzle.
 */
export function TrainerBoard({ runner, flipped, glow, children }: { runner: PuzzleRunner; flipped: boolean; glow: BoardGlow; children?: ReactNode }) {
  const orientation = flipped ? (runner.orientation === 'white' ? 'black' : 'white') : runner.orientation;
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (glow) setFlashKey((k) => k + 1);
  }, [glow]);

  return (
    <div className="relative rounded-md transition-shadow duration-500" style={{ boxShadow: glow ? GLOW_SHADOW[glow] : '0 0 0 0 transparent' }}>
      <PuzzleBoard runner={runner} orientation={orientation}>
        {glow && flashKey > 0 && <div key={flashKey} className="pointer-events-none absolute inset-0 z-30 animate-glow" style={{ background: FLASH[glow] }} />}
        {children}
      </PuzzleBoard>
    </div>
  );
}

/** Burst particles from a square of the board inside `container`. */
export function burstFromSquare(container: Element | null, square: string | null | undefined, kind: 'good' | 'bad' | 'ember' = 'good', big = false) {
  if (!container || !square) return;
  const el = container.querySelector(`[data-square="${square}"]`);
  burstAt(el, {
    colors: kind === 'good' ? PALETTES.good : kind === 'bad' ? PALETTES.bad : PALETTES.ember,
    count: big ? 46 : 26,
    power: big ? 9 : 6,
    shape: kind === 'good' && big ? 'star' : undefined,
    size: big ? 7 : 5,
  });
}
