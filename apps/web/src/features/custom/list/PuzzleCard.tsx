import type { ReactNode } from 'react';
import type { CustomPuzzle } from '../../../shared/db.ts';
import { sfx } from '../../../shared/fx/index.ts';
import { Button, Icons } from '../../../shared/ui.tsx';
import { MiniBoard, ThemeTag } from '../bits.tsx';
import { displayTitle, isSolverPly, sideName, solverSide } from '../logic.ts';
import { ratingTier } from '../editor/DetailsStep.tsx';

export interface PuzzleCardProps {
  puzzle: CustomPuzzle;
  highlight?: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => void;
}

export function PuzzleCard({ puzzle: p, highlight, onPlay, onEdit, onShare, onDelete }: PuzzleCardProps) {
  const solver = solverSide(p.fen, p.opponentFirst);
  const solverMoves = p.moves.filter((_, i) => isSolverPly(i, p.opponentFirst)).length;
  const plays = p.plays ?? 0;
  const solves = p.solves ?? 0;
  const tier = ratingTier(p.rating);
  const shownThemes = p.themes.slice(0, 3);

  return (
    <article
      data-puzzle-id={p.id}
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-ink-850 shadow-xl shadow-black/20 transition duration-200 hover:-translate-y-1 hover:border-ink-600 hover:shadow-2xl ${
        highlight ? 'animate-pop border-ember-500/70 ring-2 ring-ember-500/40' : 'border-ink-700/60'
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          sfx.click();
          onPlay();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPlay();
          }
        }}
        className="relative block w-full cursor-pointer rounded-t-2xl p-3 pb-0 outline-none focus-visible:ring-2 focus-visible:ring-ember-400"
        aria-label={`Play ${displayTitle(p)}`}
      >
        <MiniBoard fen={p.fen} orientation={solver === 'w' ? 'white' : 'black'} className="transition duration-200 group-hover:brightness-110" />
        <span className="absolute inset-3 bottom-0 flex items-center justify-center rounded-md bg-ink-950/0 opacity-0 transition duration-200 group-hover:bg-ink-950/35 group-hover:opacity-100">
          <span className="flex h-14 w-14 scale-75 items-center justify-center rounded-full bg-ember-500 text-ink-950 shadow-xl transition duration-200 group-hover:scale-100">
            <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill="currentColor" aria-hidden>
              <path d="M7 4.5v15l12-7.5z" />
            </svg>
          </span>
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-bold leading-snug">{displayTitle(p)}</h3>
          <span className="shrink-0 rounded-lg bg-ink-800 px-2 py-0.5 font-mono text-sm font-bold" title={tier.label}>
            <span className={tier.tone}>●</span> {p.rating}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
          <span className="flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-sm ${solver === 'w' ? 'bg-ink-100' : 'bg-ink-950 ring-1 ring-ink-400'}`} />
            {sideName(solver)}
          </span>
          <span>·</span>
          <span>
            {solverMoves} move{solverMoves === 1 ? '' : 's'}
          </span>
          {shownThemes.map((t) => (
            <ThemeTag key={t} theme={t} />
          ))}
          {p.themes.length > shownThemes.length && <span className="text-ink-500">+{p.themes.length - shownThemes.length}</span>}
        </div>

        <div className="flex items-center gap-3 text-xs text-ink-400">
          <span>
            <span className="font-mono font-bold text-ink-200">{plays}</span> plays
          </span>
          <span>
            <span className="font-mono font-bold text-good-400">{solves}</span> solves
          </span>
          {plays > 0 && (
            <span className="ml-auto h-1.5 w-16 overflow-hidden rounded-full bg-ink-700" title={`${Math.round((solves / plays) * 100)}% solved`}>
              <span className="block h-full rounded-full bg-good-500" style={{ width: `${(solves / plays) * 100}%` }} />
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <Button size="sm" variant="primary" className="flex-1" onClick={onPlay}>
            Play
          </Button>
          <IconAction label="Edit" onClick={onEdit}>
            {Icons.pencil('h-4 w-4')}
          </IconAction>
          <IconAction label="Share link" onClick={onShare}>
            {Icons.share('h-4 w-4')}
          </IconAction>
          <IconAction label="Delete" onClick={onDelete} danger>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
            </svg>
          </IconAction>
        </div>
      </div>
    </article>
  );
}

function IconAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        sfx.click();
        onClick();
      }}
      className={`flex h-9 w-9 items-center justify-center rounded-xl bg-ink-800 text-ink-300 transition duration-100 active:scale-90 ${
        danger ? 'hover:bg-bad-500/20 hover:text-bad-400' : 'hover:bg-ink-700 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  );
}
