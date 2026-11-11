import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, playerMoveCount, utcDateKey, type Puzzle } from '@knightfall/core';
import { db } from '../../shared/db.ts';
import { burstAt, confetti, PALETTES, sfx } from '../../shared/fx/index.ts';
import { usePuzzleRunner, type RunnerResult, type RunnerStatus } from '../../shared/PuzzlePlayer/index.ts';
import { dailyPuzzle } from '../../shared/puzzleSource.ts';
import { Button, GameLayout, Icons, Panel } from '../../shared/ui.tsx';
import { Controls } from '../puzzles/components/Controls.tsx';
import { burstFromSquare, TrainerBoard, type BoardGlow } from '../puzzles/components/TrainerBoard.tsx';
import { useHotkeysWithHelp } from '../puzzles/useHotkeys.ts';
import { BOARD_SHORTCUTS, ShortcutHelp, type ShortcutGroup } from '../../shared/ShortcutHelp.tsx';
import { CelebrationModal } from './components/CelebrationModal.tsx';
import { DailyCard } from './components/DailyCard.tsx';
import { ShareButton } from './components/ShareButton.tsx';
import { mergeDaily, MIN_MONTH, monthOf, shareText, streakOf, type DailyEntry } from './dailyLogic.ts';

const DAILY_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Daily puzzle',
    items: [
      { keys: ['H'], label: 'Hint' },
      { keys: ['R'], label: 'Retry after a miss' },
      { keys: ['S'], label: 'Show the solution' },
      { keys: ['←', '→'], label: 'Previous / next day' },
      { keys: ['F'], label: 'Flip the board' },
      { keys: ['?'], label: 'Show this help' },
    ],
  },
  BOARD_SHORTCUTS,
];

export interface DailyViewProps {
  date: string;
  today: string;
  records: Map<string, DailyEntry>;
  streak: number;
  best: number;
  calendar: React.ReactNode;
}

interface Celebration {
  streakBefore: number;
  timeMs: number;
  clean: boolean;
}

/** One day's puzzle: board + status card + calendar. Keyed by date by the parent. */
export function DailyView({ date, today, records, streak, best, calendar }: DailyViewProps) {
  const navigate = useNavigate();
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [practice, setPractice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const boardWrap = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const firstResult = useRef<RunnerResult | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Load the puzzle and whether this date already has a final result.
  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([dailyPuzzle(date), db.daily.get(date)])
      .then(([p, rec]) => {
        if (!alive) return;
        setPractice(!!(rec?.solved || (date < utcDateKey(new Date()) && rec?.solvedLate)));
        startedAt.current = Date.now();
        setPuzzle(p);
      })
      .catch((e: unknown) => alive && setError((e as Error).message || 'Could not load the daily puzzle.'));
    return () => {
      alive = false;
    };
  }, [date, reload]);

  const practiceRef = useRef(practice);
  practiceRef.current = practice;

  const recordOutcome = useCallback(
    async (p: Puzzle, solved: boolean, clean: boolean) => {
      if (practiceRef.current) return;
      const late = date < utcDateKey(new Date());
      try {
        await db.transaction('rw', db.daily, async () => {
          const existing = await db.daily.get(date);
          const next = mergeDaily(existing, { date, puzzleId: p.id, solved, clean, late, at: Date.now() });
          if (next) await db.daily.put(next);
        });
      } catch (e) {
        console.error('Failed to save daily result', e);
        setError('Could not save your result.');
      }
    },
    [date],
  );

  const runner = usePuzzleRunner(puzzle, {
    solvedSound: false,
    onComplete: (r) => {
      firstResult.current = r;
      void recordOutcome(r.puzzle, r.solved, r.solved && r.hintsUsed === 0 && r.mistakes === 0);
    },
  });
  const { status } = runner;
  const finished = status === 'solved' || status === 'failed' || status === 'solution';

  // Solved: burst + sound; a same-day first solve gets the full celebration.
  const prevStatus = useRef<RunnerStatus>('idle');
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (status !== 'solved' || prev === 'solved' || !puzzle) return;
    const counts = !practice && date === utcDateKey(new Date());
    burstFromSquare(boardWrap.current, runner.lastMove?.[1], 'good', true);
    if (runner.retrying) void recordOutcome(puzzle, true, false);
    if (!counts) {
      sfx.solved();
      return;
    }
    const fr = firstResult.current;
    const before = streakOf([...records.values()].filter((r) => r.date !== date), date);
    setCelebration({
      streakBefore: before,
      timeMs: fr?.solved ? fr.timeMs : Date.now() - startedAt.current,
      clean: !!fr?.solved && fr.hintsUsed === 0 && fr.mistakes === 0,
    });
    sfx.win();
    confetti({ count: 110 });
    timers.current.push(
      setTimeout(() => burstAt(document.querySelector('[data-daily-streak]'), { count: 30, colors: PALETTES.ember, shape: 'star', power: 7 }), 500),
      setTimeout(() => setModalOpen(true), 1200),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const glow: BoardGlow = status === 'solved' ? 'good' : status === 'failed' || status === 'solution' ? 'bad' : null;
  const late = date < today;
  const record = records.get(date);
  const moves = puzzle ? playerMoveCount(puzzle) : 0;
  const share =
    record && puzzle
      ? shareText({
          date,
          solved: record.solved || !!record.solvedLate,
          late: !record.solved && (!!record.solvedLate || !!record.playedLate),
          moves,
          streak,
          clean: record.clean,
        })
      : null;

  const shareReady = !!share && (finished || practice);

  const prevDay = addDays(date, -1);
  const nextDay = addDays(date, 1);
  const go = (d: string): void => {
    void navigate(d >= today ? '/daily' : `/daily/${d}`);
  };
  const canPrev = monthOf(prevDay) >= MIN_MONTH;
  const canNext = date < today;

  const canHint = status === 'player';
  const canRetry = status === 'failed';
  const canSolution = status === 'player' || status === 'opponent' || status === 'failed';
  const help = useHotkeysWithHelp(
    {
      h: () => (canHint ? runner.hint() : false),
      r: () => (canRetry ? runner.retry() : false),
      s: () => (canSolution ? runner.showSolution() : false),
      f: () => setFlipped((f) => !f),
      arrowleft: () => (canPrev ? go(prevDay) : false),
      arrowright: () => (canNext ? go(nextDay) : false),
    },
    !modalOpen,
  );

  return (
    <>
      <GameLayout
        board={
          <div ref={boardWrap} className="relative">
            <TrainerBoard runner={runner} flipped={flipped} glow={glow}>
              {!puzzle && !error && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink-950/40">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-ink-600 border-t-ember-400" />
                </div>
              )}
            </TrainerBoard>
          </div>
        }
        side={
          <div className="flex flex-col gap-3">
            {error && (
              <Panel className="space-y-3">
                <p className="font-semibold text-bad-400">{error}</p>
                <Button variant="primary" onClick={() => setReload((n) => n + 1)}>
                  {Icons.retry('h-4 w-4')} Try again
                </Button>
              </Panel>
            )}
            <DailyCard runner={runner} date={date} today={today} record={record} practice={practice} finished={finished}>
              <div className="mt-4 border-t border-ink-700/60 pt-4">
                <Controls
                  canHint={canHint}
                  canRetry={canRetry}
                  canSolution={canSolution}
                  onHint={runner.hint}
                  onRetry={runner.retry}
                  onSolution={runner.showSolution}
                  onFlip={() => setFlipped((f) => !f)}
                  action={
                    (shareReady || late) && (
                    <div className="grid gap-2">
                      {shareReady && share && <ShareButton text={share} size="lg" variant={status === 'solved' ? 'primary' : 'secondary'} />}
                      {late && (
                        <Button variant={shareReady ? 'ghost' : 'secondary'} onClick={() => navigate('/daily')}>
                          {Icons.calendar('h-4 w-4')} Back to today’s puzzle
                        </Button>
                      )}
                    </div>
                    )
                  }
                  extra={
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={help.openHelp} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
                        {Icons.help('h-4 w-4')}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!canPrev} onClick={() => go(prevDay)} title="Previous day (←)" aria-label="Previous day">
                        <span className="inline-block rotate-180">{Icons.next('h-4 w-4')}</span>
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!canNext} onClick={() => go(nextDay)} title="Next day (→)" aria-label="Next day">
                        {Icons.next('h-4 w-4')}
                      </Button>
                    </div>
                  }
                />
              </div>
            </DailyCard>
            {calendar}
          </div>
        }
      />
      <ShortcutHelp open={help.helpOpen} onClose={help.closeHelp} groups={DAILY_SHORTCUTS} />
      {celebration && share && (
        <CelebrationModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          streakBefore={celebration.streakBefore}
          streak={streak}
          best={best}
          moves={moves}
          timeMs={celebration.timeMs}
          clean={celebration.clean}
          share={share}
        />
      )}
    </>
  );
}
