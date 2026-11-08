import type { ReactNode } from 'react';
import { ProgressDots, PuzzlePrompt, type PuzzleRunner } from '../../../shared/PuzzlePlayer/index.ts';
import { Pill } from '../../../shared/ui.tsx';
import { sortThemes, themeLabel } from '../../puzzles/logic.ts';
import { dayLabel, type DailyEntry } from '../dailyLogic.ts';

export interface DailyCardProps {
  runner: PuzzleRunner;
  date: string;
  today: string;
  record: DailyEntry | undefined;
  /** Result for this date was already saved when the puzzle loaded: playing again changes nothing. */
  practice: boolean;
  /** Whether the puzzle has reached an outcome. */
  finished: boolean;
  children?: ReactNode;
}

/** Date header, prompt/progress, status line and the (revealed after finishing) puzzle details. */
export function DailyCard({ runner, date, today, record, practice, finished, children }: DailyCardProps) {
  const isToday = date === today;
  const late = date < today;
  const puzzle = runner.puzzle;
  const revealed = !!puzzle && (finished || practice || runner.retrying);

  let note: ReactNode = null;
  let tone = 'text-ink-400';
  if (practice) {
    note = record?.solved ? 'You already solved this one — replaying it is just for fun.' : 'Your late solve is saved — replaying it is just for fun.';
  } else if (runner.status === 'solved') {
    if (late) {
      note = 'Solved late ✓ Saved on your calendar (late solves don’t count toward the streak).';
      tone = 'text-sky-400';
    } else {
      note = runner.retrying || runner.hintsUsed > 0 ? 'Solved! Counts for your streak.' : 'Flawless! First try, no hints.';
      tone = 'text-good-400';
    }
  } else if (runner.status === 'failed' || runner.status === 'solution' || runner.retrying) {
    note = runner.status !== 'solution' ? (late ? 'Not quite. Try again — a late solve still goes on your calendar.' : 'Not quite — keep trying. A solve today still keeps your streak.') : 'Solution shown.';
    tone = 'text-bad-400';
  } else if (late) {
    note = 'Playing late: it goes on your calendar but won’t count for the streak.';
  } else if (runner.hintsUsed > 0) {
    note = 'Hint used — it still counts, just not flawless.';
    tone = 'text-sky-400';
  }

  const themes = puzzle ? sortThemes(puzzle.themes).slice(0, 4) : [];

  return (
    <div className="rounded-2xl border border-ink-700/60 bg-ink-850 p-4 shadow-xl shadow-black/20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{isToday ? 'Today' : 'Daily puzzle'}</div>
          <div className="font-bold">{dayLabel(date)}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {isToday && !record?.solved && <Pill className="bg-ember-500/15 text-ember-300">Today</Pill>}
          {record?.solved && <Pill className="bg-good-500/15 text-good-400">✓ Solved{record.clean ? ' · first try' : ''}</Pill>}
          {!record?.solved && record?.solvedLate && <Pill className="bg-sky-400/15 text-sky-400">✓ Solved late</Pill>}
          {late && !record?.solved && <Pill className="bg-sky-400/15 text-sky-400">Played late</Pill>}
          {practice && <Pill>Practice</Pill>}
        </div>
      </div>

      <PuzzlePrompt runner={runner} />
      <div className="mt-3 flex items-center justify-between gap-3">
        <ProgressDots runner={runner} />
        {revealed && puzzle && (
          <span key={puzzle.id} className="inline-block animate-pop font-mono text-sm text-ink-400">
            rated <span className="font-bold text-ink-200">{puzzle.rating}</span>
          </span>
        )}
      </div>
      {note && (
        <p key={String(note)} className={`mt-3 animate-pop text-sm font-semibold ${tone}`}>
          {note}
        </p>
      )}
      {revealed && themes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {themes.map((t, i) => (
            <span key={t} className="inline-flex animate-pop" style={{ animationDelay: `${i * 60}ms` }}>
              <Pill>{themeLabel(t)}</Pill>
            </span>
          ))}
        </div>
      )}
      {revealed && finished && puzzle?.gameUrl && (
        <a href={puzzle.gameUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-ink-500 transition hover:text-ink-300">
          Puzzle via the Lichess database (CC0) · View on Lichess ↗
        </a>
      )}
      {children}
    </div>
  );
}
