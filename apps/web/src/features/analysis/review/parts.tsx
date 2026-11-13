import { memo, useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { type AnalysedMove, type EngineLine, type GameReport, type MoveClass, type PositionEval } from '@knightfall/core';
import type { StoredGame } from '../../../shared/db.ts';
import { MOVE_CLASS_META, MoveGlyph } from '../../../shared/analysis/index.ts';
import { motionOff, motionScale, useSettings } from '../../../shared/settings.ts';
import { Button } from '../../../shared/ui.tsx';
import { barLabel, figurineSan, formatScore, moveHasIcon, squarePos } from './reviewExtras.ts';
import { lineToSan, moveRows, nearestPoint, resultLabel, type GraphGeometry, type MoveRow } from './reviewLogic.ts';

/** Milliseconds for a decorative transition, honouring the animation setting and reduced motion. */
function useMotionMs(base: number): number {
  useSettings();
  return motionOff() ? 0 : Math.round(base * motionScale());
}

/* ---------------------------------- header ---------------------------------- */

const SITE_NAME = { lichess: 'Lichess', chesscom: 'chess.com', pgn: '' } as const;

export const ReviewHeader = memo(function ReviewHeader({ game, report }: { game: StoredGame; report: GameReport | null }) {
  const opening = report?.opening?.name ?? game.opening?.name;
  const date = new Date(game.playedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <header className="mx-auto mb-4 w-full max-w-6xl">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to="/analysis" className="inline-flex items-center gap-1 text-sm font-bold text-ember-400 hover:text-ember-300">
          <span aria-hidden>‹</span> Game Review
        </Link>
        <span className="text-sm font-bold text-ink-100">{game.white.name} vs {game.black.name}</span>
        <span className="text-xs text-ink-400">
          {resultLabel(game.result)}
          {opening ? ` · ${opening}` : ''} · {date}
          {game.speed ? ` · ${game.speed}` : ''}
        </span>
        {game.url && (
          <a href={game.url} target="_blank" rel="noreferrer" className="text-xs text-ink-400 underline hover:text-ink-200">
            View on {SITE_NAME[game.source] || 'site'}
          </a>
        )}
      </div>
    </header>
  );
});

export function ProgressBar({ done, total, engineLabel, depth, onCancel }: { done: number; total: number; engineLabel: string; depth: number; onCancel: () => void }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="mx-auto mb-4 w-full max-w-6xl rounded-xl border border-ink-700/60 bg-ink-850 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-ink-200">
          Analysing with {engineLabel} · depth {depth}
          <span className="ml-2 font-mono text-xs text-ink-400">{done}/{total}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="h-full rounded-full bg-ember-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* --------------------------------- eval bar --------------------------------- */

export const EvalBar = memo(function EvalBar({ fraction, e, orientation }: { fraction: number; e: PositionEval | undefined; orientation: 'white' | 'black' }) {
  const ms = useMotionMs(320);
  const whiteBottom = orientation === 'white';
  const whiteAhead = fraction >= 0.5;
  // The label sits at the leading side's end of the bar.
  const labelAtBottom = whiteBottom === whiteAhead;
  const label = barLabel(e?.score);
  return (
    <div className="relative w-6 shrink-0 overflow-hidden rounded-md bg-ink-950 shadow-inner sm:w-7" role="img" aria-label={`Evaluation ${formatScore(e?.score)}`}>
      <div
        className="absolute inset-x-0 bg-ink-100"
        style={{ height: `${fraction * 100}%`, [whiteBottom ? 'bottom' : 'top']: 0, transition: `height ${ms}ms cubic-bezier(0.2,0.8,0.2,1)` }}
      />
      <div className="absolute inset-x-0 top-1/2 h-px bg-ember-500/60" />
      {label && (
        <span className={`absolute inset-x-0 text-center font-mono text-[10px] font-bold ${labelAtBottom ? 'bottom-1' : 'top-1'} ${whiteAhead ? 'text-ink-900' : 'text-ink-100'}`}>
          {label}
        </span>
      )}
    </div>
  );
});

/* -------------------------------- eval graph -------------------------------- */

export const GRAPH_W = 600;
export const GRAPH_H = 100;
const GRAPH_PAD = 4;

export interface GraphDot {
  key: number;
  x: number;
  y: number;
  color: string;
  label: string;
}

export const EvalGraph = memo(function EvalGraph({ geom, count, current, dots, onSeek }: {
  geom: GraphGeometry;
  /** Number of positions (moves + 1). */
  count: number;
  /** Shown position, or null for no cursor (summary). */
  current: number | null;
  dots: GraphDot[];
  onSeek: (index: number) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const last = useRef(-1);
  const seek = useCallback(
    (e: ReactPointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const x = ((e.clientX - rect.left) / rect.width) * GRAPH_W;
      const i = nearestPoint(geom.points, x);
      if (i !== null && i !== last.current) {
        last.current = i;
        onSeek(i);
      }
    },
    [geom, onSeek],
  );
  const curX = current === null ? null : GRAPH_PAD + (count <= 1 ? (GRAPH_W - GRAPH_PAD * 2) / 2 : (current / (count - 1)) * (GRAPH_W - GRAPH_PAD * 2));
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
      className="block w-full cursor-pointer touch-none select-none rounded-xl bg-ink-900"
      role="slider"
      aria-label="Evaluation graph"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, count - 1)}
      aria-valuenow={current ?? 0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = -1;
        seek(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) seek(e);
      }}
    >
      {geom.area && <path d={geom.area} fill="var(--color-ink-200)" opacity={0.85} />}
      <line x1={0} x2={GRAPH_W} y1={geom.midY} y2={geom.midY} stroke="var(--color-ember-500)" strokeOpacity={0.5} strokeDasharray="4 4" />
      {geom.line && <path d={geom.line} fill="none" stroke="var(--color-ink-50)" strokeWidth={1.5} strokeLinejoin="round" />}
      {dots.map((d) => (
        <circle key={d.key} cx={d.x} cy={d.y} r={4.5} fill={d.color} stroke="var(--color-ink-950)" strokeWidth={1.5}>
          <title>{d.label}</title>
        </circle>
      ))}
      {curX !== null && <line x1={curX} x2={curX} y1={0} y2={GRAPH_H} stroke="var(--color-ember-400)" strokeWidth={2} />}
    </svg>
  );
});

/* -------------------------------- move list -------------------------------- */

const MoveCell = memo(function MoveCell({ m, active, classified, onSelect }: { m: AnalysedMove | null; active: boolean; classified: boolean; onSelect: (index: number) => void }) {
  if (!m) return <span />;
  const marked = classified && moveHasIcon(m.class);
  return (
    <button
      type="button"
      data-active={active ? 'true' : undefined}
      onClick={() => onSelect(m.ply + 1)}
      aria-label={`${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${m.san}${classified ? `, ${MOVE_CLASS_META[m.class].label}` : ''}`}
      className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm font-bold transition-colors ${active ? 'bg-ink-600 ring-1 ring-ink-400/60' : 'hover:bg-ink-800'} ${marked ? MOVE_CLASS_META[m.class].text : 'text-ink-100'}`}
    >
      {marked && <MoveGlyph cls={m.class} size={16} />}
      <span className="truncate">{figurineSan(m.san, m.color)}</span>
    </button>
  );
});

export const MoveList = memo(function MoveList({ moves, classified, current, onSelect }: { moves: readonly AnalysedMove[]; classified: boolean; current: number; onSelect: (index: number) => void }) {
  const rows: MoveRow[] = useMemo(() => moveRows(moves), [moves]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  if (!rows.length) return <p className="py-3 text-center text-sm text-ink-400">No moves.</p>;
  return (
    <div ref={box} className="max-h-40 overflow-y-auto overscroll-contain pr-1 lg:max-h-56" role="list" aria-label="Moves">
      {rows.map((r) => (
        <div key={`${r.moveNumber}-${r.white?.ply ?? r.black?.ply}`} role="listitem" className="grid grid-cols-[2.25rem_1fr_1fr] items-center gap-1">
          <span className="text-right font-mono text-xs text-ink-500">{r.moveNumber}.</span>
          <MoveCell m={r.white} active={r.white?.ply === current - 1} classified={classified} onSelect={onSelect} />
          <MoveCell m={r.black} active={r.black?.ply === current - 1} classified={classified} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
});

/* ------------------------------- exploration ------------------------------- */

export function ExplorePanel({ fen, live, sans, startLabel, cursor, onCursor, onBack }: {
  fen: string;
  live: PositionEval | null;
  sans: string[];
  /** Number label of the first variation move, e.g. "12." or "12...". */
  startLabel: { number: number; black: boolean };
  cursor: number;
  onCursor: (c: number) => void;
  onBack: () => void;
}) {
  const lines: EngineLine[] = live?.lines.slice(0, 3) ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-violet-400/15 px-2.5 py-1 text-xs font-extrabold text-violet-400">Exploring</span>
        <Button size="sm" variant="primary" onClick={onBack}>Back to game</Button>
      </div>
      <div className="flex flex-wrap gap-1 font-mono text-sm">
        {sans.map((san, i) => {
          const blackMove = (startLabel.black ? i + 1 : i) % 2 === 1;
          const num = startLabel.number + Math.floor((startLabel.black ? i + 1 : i) / 2);
          const prefix = !blackMove ? `${num}.` : i === 0 ? `${num}...` : '';
          return (
            <button key={i} type="button" onClick={() => onCursor(i + 1)} className={`rounded px-1.5 py-0.5 ${cursor === i + 1 ? 'bg-violet-400/20 text-violet-400' : 'text-ink-200 hover:bg-ink-800'}`}>
              {prefix && <span className="mr-1 text-ink-500">{prefix}</span>}
              {san}
            </button>
          );
        })}
      </div>
      <div className="space-y-1.5" aria-live="off">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Engine {live ? `· depth ${live.depth}` : '· thinking…'}</div>
        {lines.length === 0 && <div className="h-16 animate-pulse rounded-xl bg-ink-800/60" />}
        {lines.map((l, i) => (
          <div key={i} className="flex items-start gap-2 rounded-xl bg-ink-800/70 px-2.5 py-1.5">
            <span className="w-12 shrink-0 rounded bg-ink-950 px-1 py-0.5 text-center font-mono text-xs font-bold">{formatScore(l.score)}</span>
            <span className="min-w-0 break-words font-mono text-xs text-ink-200">{lineToSan(fen, l.pv, 6).join(' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ board badge ------------------------------ */

/** A move-class badge in the top-right corner of a square. Render as a child of <Board>. */
export const MoveBadge = memo(function MoveBadge({ square, orientation, cls }: { square: string; orientation: 'white' | 'black'; cls: MoveClass }) {
  const { col, row } = squarePos(square, orientation);
  return (
    <div className="pointer-events-none absolute z-[45] h-[12.5%] w-[12.5%]" style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}>
      <MoveGlyph cls={cls} size={100} className="absolute right-[2%] top-[2%] !h-[42%] !w-[42%] drop-shadow-md" />
    </div>
  );
});
