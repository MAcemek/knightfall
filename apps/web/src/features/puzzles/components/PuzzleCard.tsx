import type { ReactNode } from 'react';
import { ProgressDots, PuzzlePrompt, type PuzzleRunner } from '../../../shared/PuzzlePlayer/index.ts';
import { Pill } from '../../../shared/ui.tsx';
import { sortThemes, themeLabel } from '../logic.ts';
import type { PuzzleResult, SessionMode } from '../useRatedSession.ts';

/** Whether the runner has reached an outcome (rating & themes may be revealed). */
export function isFinished(status: PuzzleRunner['status']) {
  return status === 'solved' || status === 'failed' || status === 'solution';
}

/** Prompt, progress, outcome line, and the hidden-until-finished puzzle rating & themes. */
export function PuzzleCard({ runner, mode, result, children }: { runner: PuzzleRunner; mode: SessionMode; result: PuzzleResult | null; children?: ReactNode }) {
  const puzzle = runner.puzzle;
  const revealed = !!puzzle && (isFinished(runner.status) || result !== null || runner.retrying);
  const themes = puzzle ? sortThemes(puzzle.themes).slice(0, 5) : [];

  return (
    <div className="rounded-2xl border border-ink-700/60 bg-ink-850 p-4 shadow-xl shadow-black/20">
      <div className="flex items-start justify-between gap-3">
        <PuzzlePrompt runner={runner} />
        {mode === 'replay' && <Pill className="shrink-0 bg-sky-400/15 text-sky-400">Replay · unrated</Pill>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <ProgressDots runner={runner} />
        <OutcomeLine runner={runner} mode={mode} result={result} />
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 border-t border-ink-700/60 pt-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">Puzzle</span>
        <div className="flex items-center gap-2">
          {revealed ? (
            <span key={puzzle?.id} className="inline-block animate-pop font-mono text-lg font-bold text-ink-100">
              {puzzle?.rating}
            </span>
          ) : (
            <span className="inline-flex h-7 w-14 items-center justify-center rounded-md bg-ink-700/70 font-mono font-bold text-ink-400" title="Revealed when you finish">
              ?
            </span>
          )}
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">Themes</span>
        <div className="flex min-h-7 flex-wrap gap-1.5">
          {revealed ? (
            themes.length ? (
              themes.map((t, i) => (
                <span key={`${puzzle?.id}-${t}`} className="inline-flex animate-pop" style={{ animationDelay: `${i * 60}ms` }}>
                  <Pill>{themeLabel(t)}</Pill>
                </span>
              ))
            ) : (
              <span className="text-sm text-ink-500">—</span>
            )
          ) : (
            <>
              <span className="h-6 w-14 rounded-full bg-ink-700/70" />
              <span className="h-6 w-20 rounded-full bg-ink-700/70" />
              <span className="h-6 w-10 rounded-full bg-ink-700/70" />
            </>
          )}
        </div>
      </div>

      {revealed && puzzle?.gameUrl && isFinished(runner.status) && (
        <a
          href={puzzle.gameUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-ink-500 transition hover:text-ink-300"
        >
          Puzzle via the Lichess database (CC0) · View on Lichess ↗
        </a>
      )}
      {children}
    </div>
  );
}

function OutcomeLine({ runner, mode, result }: { runner: PuzzleRunner; mode: SessionMode; result: PuzzleResult | null }) {
  let text: ReactNode = null;
  let tone = 'text-ink-400';
  if (runner.status === 'solved' && runner.retrying) {
    text = 'Solved on retry · unrated';
    tone = 'text-good-400';
  } else if (runner.retrying && runner.status === 'player') {
    text = mode === 'rated' && result?.kind === 'loss' && result.delta !== 0 ? `−${Math.abs(result.delta)} · keep trying` : 'Keep trying · unrated';
    tone = 'text-ember-400';
  } else if (mode === 'rated' && result) {
    if (result.kind === 'gain') {
      text = `+${result.delta} rating`;
      tone = 'text-good-400';
    } else if (result.kind === 'loss') {
      text = result.delta === 0 ? 'No change' : `−${Math.abs(result.delta)} rating`;
      tone = 'text-bad-400';
    } else if (result.kind === 'hinted') {
      text = 'Hint used · no change';
      tone = 'text-sky-400';
    }
  } else if (runner.hintsUsed > 0 && mode === 'rated' && !isFinished(runner.status)) {
    text = 'Hint used · no gain';
    tone = 'text-sky-400';
  }
  if (!text) return null;
  return (
    <span key={String(text)} className={`inline-block animate-pop text-right text-sm font-bold ${tone}`}>
      {text}
    </span>
  );
}
