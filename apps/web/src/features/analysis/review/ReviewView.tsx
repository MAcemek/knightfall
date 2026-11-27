import { memo, useEffect, useRef, type ReactNode } from 'react';
import { coachBestText, coachExplainText, coachMoveText, moveSentence, showsBestMove, type AnalysedMove, type MoveClass, type PositionEval, type Side } from '@knightfall/core';
import { MOVE_CLASS_META, MoveGlyph } from '../../../shared/analysis/index.ts';
import { Button, Icons } from '../../../shared/ui.tsx';
import { CoachBubble } from './CoachBubble.tsx';
import { EvalGraph, MoveList, type GraphDot } from './parts.tsx';
import { capitalise, figurineSan, formatScore, type LineRow } from './reviewExtras.ts';
import type { GraphGeometry } from './reviewLogic.ts';
import type { RetryTone } from './retryLogic.ts';

export function NavButton({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
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
export function ReviewNav(p: { explore: boolean; lineMode?: boolean; ply: number; count: number; playing: boolean; onFirst: () => void; onBack: () => void; onNext: () => void; onLast: () => void; onTogglePlay: () => void }) {
  return (
      <div className="flex items-center gap-2" role="group" aria-label={p.lineMode ? 'Line navigation' : 'Move navigation'}>
        <NavButton label={p.lineMode ? 'First step' : 'First move'} onClick={p.onFirst} disabled={!p.explore && p.ply === 0}>
          <path d="M6 5v14M19 5l-9 7 9 7z" />
        </NavButton>
        <NavButton label={p.lineMode ? 'Previous step' : 'Previous move'} onClick={p.onBack} disabled={!!p.lineMode && p.ply === 0}>
          <path d="M17 5l-9 7 9 7z" />
        </NavButton>
        <NavButton label={p.lineMode ? (p.playing ? 'Pause line' : 'Play line') : p.playing ? 'Pause autoplay' : 'Play automatically'} onClick={p.onTogglePlay} active={p.playing} disabled={!!p.explore}>
          {p.playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5l11 7-11 7z" />}
        </NavButton>
        <NavButton label={p.lineMode ? 'Next step' : 'Next move'} onClick={p.onNext} disabled={!!p.lineMode && p.ply >= p.count}>
          <path d="M7 5l9 7-9 7z" />
        </NavButton>
        <NavButton label={p.lineMode ? 'Last step' : 'Last move'} onClick={p.onLast} disabled={!p.explore && p.ply >= p.count}>
          <path d="M18 5v14M5 5l9 7-9 7z" />
        </NavButton>
      </div>
  );
}

/** What the bubble shows under the headline. */
export type TipMode = 'move' | 'explain' | 'best';

/** The Explain or Best line shown next to the board: one row per move with the idea behind it. */
export interface LineView {
  kind: 'explain' | 'best';
  rows: LineRow[];
  /** The step on the board: -1 = the position before the line, rows.length - 1 = its last move. */
  current: number;
  paused: boolean;
}

const LINE_TITLE: Record<LineView['kind'], string> = { explain: 'Line the opponent can play', best: 'Better line' };

/** Desktop: the moves of the line with a note each, the current one highlighted. Same height as the move list. */
function LineList({ line, onSelect }: { line: LineView; onSelect: (index: number) => void }) {
  const box = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // Scroll only the list, never the window (same reason as the move list).
    const c = box.current;
    const el = c?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!c || !el) return;
    const cr = c.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < cr.top) c.scrollTop += er.top - cr.top - 4;
    else if (er.bottom > cr.bottom) c.scrollTop += er.bottom - cr.bottom + 4;
  }, [line.current]);
  return (
    <ul ref={box} className="h-40 space-y-0.5 overflow-y-auto overscroll-contain pr-1 [overflow-anchor:none] lg:h-56" aria-label={LINE_TITLE[line.kind]}>
      {line.rows.map((r, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => onSelect(i)}
            aria-current={i === line.current ? 'step' : undefined}
            aria-label={r.note ? `${r.label}, ${r.note}` : r.label}
            className={`grid min-h-9 w-full grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-ember-400 ${i === line.current ? 'bg-ink-700 ring-1 ring-ember-400' : ''}`}
          >
            <span className="whitespace-nowrap font-mono font-bold text-ink-100">{r.label}</span>
            <span className="min-w-0 break-words text-ink-300">{r.note ? capitalise(r.note) : ''}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Which of the action buttons are usable / lit. All four are always rendered so nothing moves between moves. */
export interface ReviewActions {
  canExplain: boolean;
  canBest: boolean;
  canRetry: boolean;
  canNext: boolean;
  explainOn: boolean;
  bestOn: boolean;
  retryOn: boolean;
}

/** Filter chip state: stepping through one side's moves of one class. */
export interface ClassFilterView {
  side: Side;
  cls: MoveClass;
  /** 1-based position of the shown move in the list, 0 when it is not one of them. */
  index: number;
  total: number;
}

const ON = 'ring-2 ring-ember-400';

/**
 * Explain | Best | Retry | Next. A fixed four-column grid of 52px buttons: Retry is greyed out (not removed)
 * on moves that cannot be retried, so Next never changes position. Phones show the same row above the nav bar.
 */
export function ActionRow({ a, onExplain, onBest, onRetry, onNext, className = '' }: { a: ReviewActions; onExplain: () => void; onBest: () => void; onRetry: () => void; onNext: () => void; className?: string }) {
  return (
    <div className={`grid grid-cols-4 gap-2 ${className}`} role="group" aria-label="Move coaching">
      <Button size="dock" variant="secondary" disabled={!a.canExplain} aria-pressed={a.explainOn} className={a.explainOn ? ON : ''} onClick={onExplain}>
        {Icons.bulb('h-5 w-5')}
        Explain
      </Button>
      <Button size="dock" variant="secondary" disabled={!a.canBest} aria-pressed={a.bestOn} className={a.bestOn ? ON : ''} onClick={onBest}>
        {Icons.target('h-5 w-5')}
        Best
      </Button>
      <Button size="dock" variant="secondary" disabled={!a.canRetry} aria-pressed={a.retryOn} className={a.retryOn ? ON : ''} onClick={onRetry}>
        {Icons.retry('h-5 w-5')}
        Retry
      </Button>
      <Button size="dock" variant="good" disabled={!a.canNext} onClick={onNext}>
        {Icons.next('h-5 w-5')}
        Next
      </Button>
    </div>
  );
}

const RETRY_TITLE: Record<RetryTone, string> = { ask: 'text-ink-900', bad: 'text-bad-600', good: 'text-ember-600', best: 'text-good-600' };

/**
 * Phones only (lg:hidden): the coach bubble above the board, compact and a FIXED height (5.5rem) so the board and the
 * buttons never move whatever the move, tip or mode. Desktop keeps the bubble in the panel.
 */
export const PhoneCoach = memo(function PhoneCoach(props: {
  move: AnalysedMove | null;
  evalAfter: PositionEval | undefined;
  bestLine: string[];
  previewing: boolean;
  exploring: boolean;
  perspective: Side | null;
  tipMode: TipMode;
  /** The Explain or Best line: the bubble shows the note of the current step. */
  line: LineView | null;
  retry: { title: string; text: string; tone: RetryTone } | null;
  onShowLine: () => void;
  onShowAnswer: () => void;
}) {
  const { move, evalAfter, bestLine, previewing, exploring, tipMode, retry, line } = props;
  const stepRow = line && line.current >= 0 ? line.rows[Math.min(line.current, line.rows.length - 1)] : null;
  const bestSan = move?.best && move.best.uci !== move.uci ? move.best.san : null;
  const chip =
    move && !exploring ? (
      <span className="rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink-100" aria-label={`Evaluation ${formatScore(evalAfter?.score, evalAfter?.terminal)}`}>
        {formatScore(evalAfter?.score, evalAfter?.terminal)}
      </span>
    ) : undefined;
  const tip = move ? coachMoveText(move, move.insight, props.perspective) : '';
  const longTip = move
    ? tipMode === 'explain'
      ? coachExplainText(move, move.insight, props.perspective) || tip
      : tipMode === 'best'
        ? coachBestText(move, move.insight, props.perspective) || tip
        : ''
    : '';
  const shownTip = longTip || tip;
  const headline = move && (
    <div className="flex items-center gap-1.5 pr-12 text-[14px] font-bold leading-5">
      <MoveGlyph cls={move.class} size={18} title={MOVE_CLASS_META[move.class].label} />
      <span className="truncate">{moveSentence(figurineSan(move.san, move.color), move.class)}</span>
    </div>
  );

  const body = (() => {
    if (exploring) return <p className="line-clamp-3 text-[13px] font-medium leading-4 text-ink-700">Exploring a variation. The engine lines are in the panel below; press Esc or use the nav bar to go back to the game.</p>;
    if (!move) return <p className="line-clamp-3 text-[13px] font-medium leading-4 text-ink-700">Starting position. Press Next to step through the game.</p>;
    if (retry) {
      return (
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-[14px] font-extrabold leading-5 ${RETRY_TITLE[retry.tone]}`}>{retry.title}</span>
            <button type="button" onClick={props.onShowAnswer} className="shrink-0 rounded-md bg-good-500 px-2 py-0.5 text-xs font-extrabold text-ink-950 hover:bg-good-400">
              Show answer
            </button>
          </div>
          <p className="line-clamp-3 text-[13px] font-medium leading-4 text-ink-700" title={retry.text}>{retry.text}</p>
        </div>
      );
    }
    return (
      <div>
        {headline}
        {shownTip && <p className={`${stepRow ? 'line-clamp-1' : 'line-clamp-2'} text-[13px] font-medium leading-4 text-ink-700`} title={shownTip}>{shownTip}</p>}
        {stepRow && line && (
          <p className="line-clamp-2 text-[13px] font-bold leading-4 text-ink-900" aria-live="polite">
            {line.current + 1} of {line.rows.length}: {stepRow.label}
            {stepRow.note ? ` ${stepRow.note}` : ''}
          </p>
        )}
        {!longTip && showsBestMove(move.class) && bestSan && (
          <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium leading-5 text-ink-700">
            <span className="min-w-0 truncate">
              Best was <span className="font-bold text-ink-900">{figurineSan(bestSan, move.color)}</span>
            </span>
            {bestLine.length > 0 && (
              <>
                <span aria-hidden>{'·'}</span>
                <button
                  type="button"
                  onClick={props.onShowLine}
                  disabled={previewing}
                  className="shrink-0 rounded-md bg-good-500 px-2 text-xs font-extrabold leading-5 text-ink-950 hover:bg-good-400 disabled:opacity-50"
                >
                  {previewing ? 'Playing…' : 'Show'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  })();

  return (
    <CoachBubble compact right={chip} className="h-[5.5rem] overflow-hidden">
      <div className="h-full overflow-hidden">{body}</div>
    </CoachBubble>
  );
});

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
  perspective: Side | null;
  tipMode: TipMode;
  /** The Explain or Best line, listed in place of the move list on desktop. */
  line: LineView | null;
  /** Set while Retry is active: replaces the tip. */
  retry: { title: string; text: string; tone: RetryTone } | null;
  filter: ClassFilterView | null;
  actions: ReviewActions;
  /** Fixed-height slot between the move list and the graph (add to the next Woodpecker set). */
  woodSlot?: ReactNode;
  onExplain: () => void;
  onBest: () => void;
  onRetry: () => void;
  onShowAnswer: () => void;
  onFilterStep: (dir: 1 | -1) => void;
  onFilterClear: () => void;
  onShowLine: () => void;
  onLineSelect: (index: number) => void;
  onSummary: () => void;
  onFirst: () => void;
  onBack: () => void;
  onNext: () => void;
  onLast: () => void;
  onTogglePlay: () => void;
  onSelect: (index: number) => void;
  onSeek: (index: number) => void;
}) {
  const { moves, move, ply, evalAfter, bestLine, previewing, explorePanel, tipMode, retry, filter } = props;
  const N = moves.length;
  const bestSan = move?.best && move.best.uci !== move.uci ? move.best.san : null;
  const chip = move ? (
    <span className="rounded-md bg-ink-900 px-2 py-0.5 font-mono text-xs font-bold text-ink-100" aria-label={`Evaluation ${formatScore(evalAfter?.score, evalAfter?.terminal)}`}>
      {formatScore(evalAfter?.score, evalAfter?.terminal)}
    </span>
  ) : undefined;

  const tip = move ? coachMoveText(move, move.insight, props.perspective) : '';
  const longTip = move
    ? tipMode === 'explain'
      ? coachExplainText(move, move.insight, props.perspective) || tip
      : tipMode === 'best'
        ? coachBestText(move, move.insight, props.perspective) || tip
        : ''
    : '';
  const headline = move && (
    <div className="flex items-center gap-2">
      <MoveGlyph cls={move.class} size={22} title={MOVE_CLASS_META[move.class].label} />
      <span className={retry || longTip ? 'truncate' : ''}>{moveSentence(figurineSan(move.san, move.color), move.class)}</span>
    </div>
  );

  /* The bubble is a fixed height: whatever the text, nothing below it moves. */
  const bubble = (() => {
    if (!move) return 'Starting position. Press Next to step through the game.';
    if (retry) {
      return (
        <div className="space-y-1.5">
          <div className={`font-extrabold ${RETRY_TITLE[retry.tone]}`}>{retry.title}</div>
          <p className="line-clamp-2 text-sm font-medium text-ink-700" title={retry.text}>{retry.text}</p>
          <button type="button" onClick={props.onShowAnswer} className="rounded-md bg-good-500 px-2 py-0.5 text-xs font-extrabold text-ink-950 hover:bg-good-400">
            Show answer
          </button>
        </div>
      );
    }
    if (longTip) {
      return (
        <div className="space-y-1.5">
          {headline}
          <p className="line-clamp-4 text-sm font-medium text-ink-700" title={longTip}>{longTip}</p>
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        {headline}
        {tip && <p className="line-clamp-2 text-sm font-medium text-ink-700" title={tip}>{tip}</p>}
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
    );
  })();

  return (
    <div className="space-y-3 [overflow-anchor:none]">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <button type="button" onClick={props.onSummary} className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-ember-400 hover:text-ember-300 focus-visible:outline-2 focus-visible:outline-ember-400" aria-label="Back to the game summary">
          <span aria-hidden>{'‹'}</span> Summary
        </button>
        {filter && (
          <div className="flex min-w-0 items-center gap-1 rounded-full bg-ink-800 py-0.5 pl-2 pr-0.5 text-xs font-bold text-ink-100" role="group" aria-label="Move filter">
            <MoveGlyph cls={filter.cls} size={16} />
            <span className="truncate" aria-live="polite">
              {MOVE_CLASS_META[filter.cls].label} {filter.index > 0 ? filter.index : '–'} of {filter.total}
            </span>
            <button type="button" aria-label="Previous in this filter" onClick={() => props.onFilterStep(-1)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-ember-400 max-lg:h-9 max-lg:w-9">
              {Icons.chevLeft('h-4 w-4')}
            </button>
            <button type="button" aria-label="Next in this filter" onClick={() => props.onFilterStep(1)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-ember-400 max-lg:h-9 max-lg:w-9">
              {Icons.chevRight('h-4 w-4')}
            </button>
            <button type="button" aria-label="Clear the filter" onClick={props.onFilterClear} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-ember-400 max-lg:h-9 max-lg:w-9">
              {Icons.x('h-4 w-4')}
            </button>
          </div>
        )}
      </div>

      {explorePanel ?? (
        <>
          <CoachBubble right={chip} className="[&>div:last-child]:h-[9.25rem] max-lg:hidden">
            <div className="h-[7.75rem] overflow-hidden">{bubble}</div>
          </CoachBubble>

          <ActionRow a={props.actions} onExplain={props.onExplain} onBest={props.onBest} onRetry={props.onRetry} onNext={props.onNext} className="max-lg:hidden" />

          {props.line && (
            <div className="max-lg:hidden">
              <LineList line={props.line} onSelect={props.onLineSelect} />
            </div>
          )}
          <div className={props.line ? 'lg:hidden' : ''}>
            <MoveList moves={moves} classified current={ply} onSelect={props.onSelect} />
          </div>
        </>
      )}

      {props.woodSlot}

      <EvalGraph geom={props.geom} count={N + 1} current={ply} dots={props.dots} onSeek={props.onSeek} />

      <div className="max-lg:hidden">
        <ReviewNav explore={!!explorePanel} lineMode={!!props.line} ply={props.line ? props.line.current + 1 : ply} count={props.line ? props.line.rows.length : N} playing={props.playing} onFirst={props.onFirst} onBack={props.onBack} onNext={props.onNext} onLast={props.onLast} onTogglePlay={props.onTogglePlay} />
      </div>
    </div>
  );
});
