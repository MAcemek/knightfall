import { memo, type ReactNode } from 'react';
import { moveSentence, showsBestMove, type AnalysedMove, type PositionEval } from '@knightfall/core';
import { MOVE_CLASS_META, MoveGlyph } from '../../../shared/analysis/index.ts';
import { Button } from '../../../shared/ui.tsx';
import { CoachBubble } from './CoachBubble.tsx';
import { EvalGraph, MoveList, type GraphDot } from './parts.tsx';
import { figurineSan, formatScore } from './reviewExtras.ts';
import type { GraphGeometry } from './reviewLogic.ts';

function NavButton({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-12 flex-1 items-center justify-center rounded-xl text-ink-100 transition-colors hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-ember-400 disabled:pointer-events-none disabled:opacity-35 ${active ? 'bg-ink-700' : 'bg-ink-800'}`}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** First / back / play / next / last. Rendered under the board on phones and at the bottom of the panel on desktop. */
export function ReviewNav(p: { explore: boolean; ply: number; count: number; playing: boolean; onFirst: () => void; onBack: () => void; onNext: () => void; onLast: () => void; onTogglePlay: () => void }) {
  return (
      <div className="flex items-center gap-2" role="group" aria-label="Move navigation">
        <NavButton label="First move" onClick={p.onFirst} disabled={!p.explore && p.ply === 0}>
          <path d="M6 5v14M19 5l-9 7 9 7z" />
        </NavButton>
        <NavButton label="Previous move" onClick={p.onBack}>
          <path d="M17 5l-9 7 9 7z" />
        </NavButton>
        <NavButton label={p.playing ? 'Pause autoplay' : 'Play automatically'} onClick={p.onTogglePlay} active={p.playing} disabled={!!p.explore}>
          {p.playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5l11 7-11 7z" />}
        </NavButton>
        <NavButton label="Next move" onClick={p.onNext}>
          <path d="M7 5l9 7-9 7z" />
        </NavButton>
        <NavButton label="Last move" onClick={p.onLast} disabled={!p.explore && p.ply >= p.count}>
          <path d="M18 5v14M5 5l9 7-9 7z" />
        </NavButton>
      </div>
  );
}

export const ReviewView = memo(function ReviewView(props: {
  moves: readonly AnalysedMove[];
  /** The move shown on the board (null at the start position). */
  move: AnalysedMove | null;
  /** Position index shown / highlighted in the list. */
  ply: number;
  /** Evaluation of the position after the shown move. */
  evalAfter: PositionEval | undefined;
  bestLine: string[];
  previewing: boolean;
  /** Set while exploring a variation: replaces the coach and move list. */
  explorePanel: ReactNode | null;
  geom: GraphGeometry;
  dots: GraphDot[];
  playing: boolean;
  onShowLine: () => void;
  onSummary: () => void;
  onFirst: () => void;
  onBack: () => void;
  onNext: () => void;
  onLast: () => void;
  onTogglePlay: () => void;
  onSelect: (index: number) => void;
  onSeek: (index: number) => void;
}) {
  const { moves, move, ply, evalAfter, bestLine, previewing, explorePanel } = props;
  const N = moves.length;
  const bestSan = move?.best && move.best.uci !== move.uci ? move.best.san : null;
  const chip = move ? (
    <span className="rounded-md bg-ink-900 px-2 py-0.5 font-mono text-xs font-bold text-ink-100" aria-label={`Evaluation ${formatScore(evalAfter?.score)}`}>
      {formatScore(evalAfter?.score)}
    </span>
  ) : undefined;

  return (
    <div className="space-y-3 [overflow-anchor:none]">
      <div className="flex items-center justify-between">
        <button type="button" onClick={props.onSummary} className="inline-flex items-center gap-1 text-sm font-bold text-ember-400 hover:text-ember-300 focus-visible:outline-2 focus-visible:outline-ember-400" aria-label="Back to the game summary">
          <span aria-hidden>{'‹'}</span> Summary
        </button>
      </div>

      {explorePanel ?? (
        <>
          <CoachBubble right={chip} className="[&>div:last-child]:min-h-[8.25rem]">
            {move ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <MoveGlyph cls={move.class} size={22} title={MOVE_CLASS_META[move.class].label} />
                  <span>{moveSentence(figurineSan(move.san, move.color), move.class)}</span>
                </div>
                {showsBestMove(move.class) && bestSan && (
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-700">
                    <span>
                      Best was <span className="font-bold text-ink-900">{figurineSan(bestSan, move.color)}</span>
                    </span>
                    {bestLine.length > 0 && (
                      <button
                        type="button"
                        onClick={props.onShowLine}
                        disabled={previewing}
                        className="rounded-md bg-good-500 px-2 py-0.5 text-xs font-extrabold text-ink-950 hover:bg-good-400 disabled:opacity-50"
                      >
                        {previewing ? 'Playing…' : 'Show'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              'Starting position. Press Next to step through the game.'
            )}
          </CoachBubble>

          <Button variant="good" size="lg" className="w-full text-lg max-lg:hidden" disabled={ply >= N} onClick={props.onNext}>
            Next
          </Button>

          <MoveList moves={moves} classified current={ply} onSelect={props.onSelect} />
        </>
      )}

      <EvalGraph geom={props.geom} count={N + 1} current={ply} dots={props.dots} onSeek={props.onSeek} />

      <div className="max-lg:hidden">
        <ReviewNav explore={!!explorePanel} ply={ply} count={N} playing={props.playing} onFirst={props.onFirst} onBack={props.onBack} onNext={props.onNext} onLast={props.onLast} onTogglePlay={props.onTogglePlay} />
      </div>
    </div>
  );
});
