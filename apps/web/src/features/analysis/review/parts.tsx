import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  MOVE_CLASSES,
  type AnalysedMove,
  type EngineLine,
  type GamePhase,
  type GameReport,
  type MoveClass,
  type PositionEval,
  typicalAccuracy,
} from '@knightfall/core';
import type { StoredGame } from '../../../shared/db.ts';
import { MOVE_CLASS_META, MoveClassChip, MoveGlyph } from '../../../shared/analysis/index.ts';
import { TickerNumber } from '../../../shared/fx/index.ts';
import { motionOff, motionScale, useSettings } from '../../../shared/settings.ts';
import { Button, Pill } from '../../../shared/ui.tsx';
import { barLabel, formatScore, moveLabel, squarePos, swingOf, userSide } from './reviewExtras.ts';
import { lineToSan, moveRows, nearestPoint, resultLabel, type GraphGeometry, type MoveRow } from './reviewLogic.ts';

/** Milliseconds for a decorative transition, honouring the animation setting and reduced motion. */
function useMotionMs(base: number): number {
  useSettings();
  return motionOff() ? 0 : Math.round(base * motionScale());
}

/* ---------------------------------- header ---------------------------------- */

function AccuracyTicker({ value }: { value: number | null }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(value ?? 0), 30);
    return () => clearTimeout(t);
  }, [value]);
  if (value === null) return <span className="font-mono text-2xl font-bold text-ink-500">–</span>;
  return <TickerNumber value={shown} duration={0.9} format={(n) => n.toFixed(1)} className="font-mono text-2xl font-bold text-ink-100" />;
}

const SITE_NAME = { lichess: 'Lichess', chesscom: 'chess.com', pgn: '' } as const;

function PlayerCard({ color, game, accuracy, siteAccuracy, mine }: {
  color: 'w' | 'b';
  game: StoredGame;
  accuracy: number | null | undefined;
  siteAccuracy: number | undefined;
  mine: boolean;
}) {
  const p = color === 'w' ? game.white : game.black;
  const site = SITE_NAME[game.source];
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-ink-800/70 px-3 py-2.5">
      <span className={`h-4 w-4 shrink-0 rounded-full border border-ink-500 ${color === 'w' ? 'bg-ink-100' : 'bg-ink-950'}`} aria-label={color === 'w' ? 'White' : 'Black'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-bold">
          {p.title && <span className="rounded bg-ember-500/15 px-1 text-[10px] font-extrabold text-ember-400">{p.title}</span>}
          <span className="truncate">{p.name}</span>
          {mine && <Pill className="!px-1.5 !py-0 text-[10px]">You</Pill>}
        </div>
        <div className="text-xs text-ink-400">{p.rating ? p.rating : 'Unrated'}</div>
      </div>
      {accuracy !== undefined && (
        <div className="text-right">
          <AccuracyTicker value={accuracy} />
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Accuracy</div>
          {siteAccuracy !== undefined && site && <div className="text-[10px] text-ink-500">{site}: {siteAccuracy.toFixed(1)}</div>}
        </div>
      )}
    </div>
  );
}

export const ReviewHeader = memo(function ReviewHeader({ game, report }: { game: StoredGame; report: GameReport | null }) {
  const me = userSide(game);
  const opening = report?.opening?.name ?? game.opening?.name;
  const date = new Date(game.playedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <header className="mx-auto mb-4 w-full max-w-6xl space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to="/analysis" className="inline-flex items-center gap-1 text-sm font-bold text-ember-400 hover:text-ember-300">
          <span aria-hidden>‹</span> Game Review
        </Link>
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
      <div className="flex flex-col gap-2 sm:flex-row">
        <PlayerCard color="w" game={game} accuracy={report ? report.accuracy.white : undefined} siteAccuracy={game.siteAccuracy?.white} mine={me === 'w'} />
        <PlayerCard color="b" game={game} accuracy={report ? report.accuracy.black : undefined} siteAccuracy={game.siteAccuracy?.black} mine={me === 'b'} />
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
  current: number;
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
  const curX = GRAPH_PAD + (count <= 1 ? (GRAPH_W - GRAPH_PAD * 2) / 2 : (current / (count - 1)) * (GRAPH_W - GRAPH_PAD * 2));
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
      className="block w-full cursor-pointer touch-none select-none rounded-xl bg-ink-900"
      role="slider"
      aria-label="Evaluation graph"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, count - 1)}
      aria-valuenow={current}
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
      <line x1={curX} x2={curX} y1={0} y2={GRAPH_H} stroke="var(--color-ember-400)" strokeWidth={2} />
    </svg>
  );
});

/* -------------------------------- move list -------------------------------- */

const MoveCell = memo(function MoveCell({ m, active, classified, onSelect }: { m: AnalysedMove | null; active: boolean; classified: boolean; onSelect: (index: number) => void }) {
  if (!m) return <span />;
  return (
    <button
      type="button"
      data-active={active ? 'true' : undefined}
      onClick={() => onSelect(m.ply + 1)}
      className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left font-mono text-sm font-semibold transition-colors ${active ? 'bg-ember-500/20 text-ember-300 ring-1 ring-ember-500/50' : 'text-ink-100 hover:bg-ink-800'}`}
    >
      <span className="truncate">{m.san}</span>
      {classified && <MoveGlyph cls={m.class} size={12} title={MOVE_CLASS_META[m.class].label} />}
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
    <div ref={box} className="max-h-60 overflow-y-auto overscroll-contain pr-1 lg:max-h-72" role="list" aria-label="Moves">
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

/* ------------------------------ explanation panel ------------------------------ */

export function ExplainPanel({ move, report, onShowLine, previewing, bestLine }: {
  move: AnalysedMove | null;
  report: GameReport | null;
  onShowLine: () => void;
  previewing: boolean;
  /** SAN of the best line from the position before the move. */
  bestLine: string[];
}) {
  if (!move) return <p className="text-sm text-ink-400">Starting position. Step through the game with the arrow keys.</p>;
  const before = report?.evals[move.ply];
  const after = report?.evals[move.ply + 1];
  const wasBest = move.best ? move.best.uci === move.uci : true;
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-lg font-extrabold">{moveLabel(move)}</span>
        {report && <MoveClassChip cls={move.class} />}
      </div>
      {report && (
        <>
          <p className="text-sm text-ink-300">{MOVE_CLASS_META[move.class].hint}.</p>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-lg bg-ink-800 px-2 py-1 font-mono">{formatScore(before?.score)}</span>
            <span className="text-ink-500" aria-hidden>→</span>
            <span className="rounded-lg bg-ink-800 px-2 py-1 font-mono">{formatScore(after?.score)}</span>
            <span className="text-xs text-ink-400">{swingOf(move) !== 0 ? `${swingOf(move) > 0 ? '+' : ''}${swingOf(move)} win%` : ''}</span>
          </div>
          {!wasBest && move.best && (
            <p className="text-sm">
              <span className="text-ink-400">Best was </span>
              <span className="font-mono font-bold text-good-400">{move.best.san}</span>
            </p>
          )}
          {bestLine.length > 0 && (
            <div className="space-y-1.5">
              <p className="break-words font-mono text-xs text-ink-300">{bestLine.join(' ')}</p>
              <Button size="sm" variant="secondary" onClick={onShowLine} disabled={previewing}>
                {previewing ? 'Playing line…' : 'Show line'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

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

/* --------------------------------- summary --------------------------------- */

const PHASES: { id: GamePhase; label: string }[] = [
  { id: 'opening', label: 'Opening' },
  { id: 'middlegame', label: 'Middlegame' },
  { id: 'endgame', label: 'Endgame' },
];

const fmt = (n: number | null) => (n === null ? '–' : n.toFixed(1));

export const SummaryPanel = memo(function SummaryPanel({ report, game, onJump }: { report: GameReport; game: StoredGame; onJump: (index: number) => void }) {
  // Calibrated on Lichess blitz/rapid ratings only; chess.com and PGN ratings are on other scales.
  const typical = game.source === 'lichess' ? { white: typicalAccuracy(game.white.rating), black: typicalAccuracy(game.black.rating) } : null;
  const showTypical = !!typical && (typical.white !== null || typical.black !== null);
  const classes = MOVE_CLASSES.filter((c: MoveClass) => report.counts.white[c] + report.counts.black[c] > 0);
  const moments = report.keyMoments.map((ply) => report.moves[ply]).filter((m): m is AnalysedMove => !!m);
  return (
    <div className="space-y-4">
      {moments.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">Key moments</h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {moments.map((m) => (
              <button
                key={m.ply}
                type="button"
                onClick={() => onJump(m.ply + 1)}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-ink-800 px-3 py-2 text-left hover:bg-ink-700"
              >
                <MoveGlyph cls={m.class} size={16} title={MOVE_CLASS_META[m.class].label} />
                <span>
                  <span className="block font-mono text-sm font-bold">{moveLabel(m)}</span>
                  <span className="block text-[10px] text-ink-400">{swingOf(m) > 0 ? '+' : ''}{swingOf(m)} win%</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-ink-400">
              <th className="pb-1 text-left font-semibold">Moves</th>
              <th className="pb-1 text-right font-semibold">White</th>
              <th className="pb-1 text-right font-semibold">Black</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <tr key={c} className="border-t border-ink-800">
                <td className="py-1">
                  <span className={`inline-flex items-center gap-1.5 ${MOVE_CLASS_META[c].text}`}>
                    <MoveGlyph cls={c} size={12} />
                    <span className="font-semibold">{MOVE_CLASS_META[c].label}</span>
                  </span>
                </td>
                <td className="py-1 text-right font-mono">{report.counts.white[c]}</td>
                <td className="py-1 text-right font-mono">{report.counts.black[c]}</td>
              </tr>
            ))}
          </tbody>
          <tbody className="border-t-2 border-ink-700">
            <tr>
              <td className="py-1 text-ink-300">Accuracy</td>
              <td className="py-1 text-right font-mono font-bold">{fmt(report.accuracy.white)}</td>
              <td className="py-1 text-right font-mono font-bold">{fmt(report.accuracy.black)}</td>
            </tr>
            {showTypical && typical && (
              <tr className="border-t border-ink-800">
                <td className="py-1 text-ink-400">
                  <span title="The middle half of single-game accuracies for players of this rating, from 4,232 rated Lichess blitz and rapid games.">
                    Typical at this rating
                  </span>
                </td>
                {([typical.white, typical.black] as const).map((band, i) => (
                  <td key={i} className="py-1 text-right font-mono text-ink-300">
                    {band ? `${band.p25}–${band.p75}` : '–'}
                  </td>
                ))}
              </tr>
            )}
            {PHASES.map((p) => (
              <tr key={p.id} className="border-t border-ink-800">
                <td className="py-1 text-ink-400">{p.label} accuracy</td>
                <td className="py-1 text-right font-mono">{fmt(report.phases[p.id].white)}</td>
                <td className="py-1 text-right font-mono">{fmt(report.phases[p.id].black)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
});

/* ------------------------------ board badge ------------------------------ */

/** A move-class badge in the top-right corner of a square. Render as a child of <Board>. */
export const MoveBadge = memo(function MoveBadge({ square, orientation, cls }: { square: string; orientation: 'white' | 'black'; cls: MoveClass }) {
  const { col, row } = squarePos(square, orientation);
  return (
    <div className="pointer-events-none absolute z-[45] h-[12.5%] w-[12.5%]" style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}>
      <span className="absolute right-[3%] top-[3%] flex h-[42%] w-[42%] items-center justify-center rounded-full bg-ink-950/85 shadow ring-1 ring-ink-100/20">
        <MoveGlyph cls={cls} size={100} className="!h-[78%] !w-[78%]" />
      </span>
    </div>
  );
});
