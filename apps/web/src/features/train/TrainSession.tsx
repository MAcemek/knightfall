import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Puzzle } from '@knightfall/core';
import { ProgressDots, PuzzlePrompt, usePuzzleRunner, type RunnerResult, type RunnerStatus } from '../../shared/PuzzlePlayer/index.ts';
import { BOARD_SHORTCUTS, ShortcutHelp, type ShortcutGroup } from '../../shared/ShortcutHelp.tsx';
import { sortThemes, themeLabel } from '../../shared/themes.ts';
import { Button, GameLayout, Icons, PageHeader, Panel, Pill, Stat } from '../../shared/ui.tsx';
import { Controls } from '../puzzles/components/Controls.tsx';
import { SolutionStepper } from '../puzzles/components/SolutionStepper.tsx';
import { burstFromSquare, TrainerBoard, type BoardGlow } from '../puzzles/components/TrainerBoard.tsx';
import { useHotkeysWithHelp } from '../puzzles/useHotkeys.ts';
import { EMPTY_TALLY, tally, tallyAccuracy, type SessionTally } from './trainLogic.ts';

export interface TrainSource {
  /** Next puzzle, or null when there is nothing (more) to play. */
  next: () => Promise<Puzzle | null>;
  /** Persist the FIRST outcome of a puzzle. Resolves to a short line shown under the prompt, or null. */
  record: (r: RunnerResult) => Promise<string | null>;
}

const TRAIN_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Training',
    items: [
      { keys: ['H'], label: 'Hint (first the piece, then the square)' },
      { keys: ['R'], label: 'Retry after a miss' },
      { keys: ['S'], label: 'Show the solution' },
      { keys: ['Enter', 'Space'], label: 'Next puzzle' },
      { keys: ['←', '→'], label: 'Step through the line once the puzzle is over' },
      { keys: ['F'], label: 'Flip the board' },
      { keys: ['?'], label: 'Show this help' },
    ],
  },
  BOARD_SHORTCUTS,
];

/**
 * One unrated training session (theme training and review share it): board, prompt, controls, hotkeys,
 * solution stepping and a running tally. `source` decides which puzzles come and how results are stored;
 * it must be referentially stable (useMemo in the parent). Remount (key) to start a different session.
 */
export function TrainSession({ title, subtitle, icon, badges, source, finished }: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  /** Row under the header (e.g. the chosen themes). */
  badges?: ReactNode;
  source: TrainSource;
  /** Shown when `source.next()` returned null. */
  finished: ReactNode;
}) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tallyState, setTallyState] = useState<SessionTally>(EMPTY_TALLY);
  const [flipped, setFlipped] = useState(false);
  const boardWrap = useRef<HTMLDivElement>(null);
  /** Guards against overlapping loads: source.next() consumes an item, so it must never run twice at once. */
  const busy = useRef(false);
  const started = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const p = await source.next();
      if (!p) setDone(true);
      else {
        setFlipped(false);
        setPuzzle({ ...p }); // fresh identity so the runner always resets
      }
    } catch (e) {
      setError((e as Error).message || 'Could not load a puzzle.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [source]);

  // First puzzle. The ref makes React StrictMode's double-invoked effect load only once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  const onComplete = useCallback(
    (r: RunnerResult) => {
      setTallyState((t) => tally(t, r.solved));
      source.record(r).then(setNote).catch(() => setError('Could not save your result.'));
    },
    [source],
  );

  const runner = usePuzzleRunner(puzzle, { onComplete });
  const { status, retrying } = runner;
  const over = status === 'solved' || status === 'failed' || status === 'solution';
  const canHint = status === 'player';
  const canRetry = status === 'failed';
  const canSolution = status === 'player' || status === 'opponent' || status === 'failed';
  const canNext = over || retrying || error !== null;
  const goNext = () => void load();

  const prevStatus = useRef<RunnerStatus>('idle');
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (status === 'solved' && prev !== 'solved') burstFromSquare(boardWrap.current, runner.lastMove?.[1], 'good', !retrying && runner.hintsUsed === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const glow: BoardGlow = status === 'solved' ? 'good' : status === 'failed' || status === 'solution' ? 'bad' : null;

  const help = useHotkeysWithHelp(
    {
      h: () => (canHint ? runner.hint() : false),
      r: () => (canRetry ? runner.retry() : false),
      s: () => (canSolution ? runner.showSolution() : false),
      f: () => setFlipped((f) => !f),
      enter: () => (canNext && !loading ? goNext() : false),
      ' ': () => (canNext && !loading ? goNext() : false),
      arrowleft: () => runner.stepBack(),
      arrowright: () => runner.stepForward(),
    },
    !done,
  );

  const tallyPanel = (
    <Panel className="grid grid-cols-3 gap-2">
      <Stat label="Solved" value={`${tallyState.solved}/${tallyState.attempted}`} />
      <Stat label="Accuracy" value={tallyAccuracy(tallyState)} />
      <Stat label="Streak" value={tallyState.streak} sub={`best ${tallyState.bestStreak}`} accent="text-ember-400" />
    </Panel>
  );

  const header = (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        right={
          <Link to="/train" className="text-sm font-semibold text-ink-400 transition-colors hover:text-ink-100">
            End session
          </Link>
        }
      />
      {badges}
    </>
  );

  if (done) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <div className="space-y-4">
          {finished}
          {tallyState.attempted > 0 && tallyPanel}
        </div>
      </div>
    );
  }

  const themes = puzzle ? sortThemes(puzzle.themes).slice(0, 5) : [];

  return (
    <>
      {header}
      <GameLayout
        board={
          <div ref={boardWrap} className="relative">
            <TrainerBoard runner={runner} flipped={flipped} glow={glow}>
              {loading && status === 'idle' && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink-950/40 backdrop-blur-[1px]">
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
                <Button variant="primary" onClick={goNext}>
                  {Icons.retry('h-4 w-4')} Try again
                </Button>
              </Panel>
            )}
            <Panel>
              <div className="flex items-start justify-between gap-3">
                <PuzzlePrompt runner={runner} />
                {puzzle && <Pill className="shrink-0 font-mono">{puzzle.rating}</Pill>}
              </div>
              <div className="mt-3">
                <ProgressDots runner={runner} />
              </div>
              <p className="mt-2 min-h-5 text-sm font-semibold text-ember-400">{note ?? ''}</p>
              <div className="mt-1 flex min-h-7 flex-wrap gap-1.5">
                {over &&
                  themes.map((t, i) => (
                    <span key={`${puzzle?.id}-${t}`} className="inline-flex animate-pop" style={{ animationDelay: `${i * 60}ms` }}>
                      <Pill>{themeLabel(t)}</Pill>
                    </span>
                  ))}
              </div>
              <div className="mt-4 border-t border-ink-700/60 pt-4">
                <Controls
                  canHint={canHint}
                  canRetry={canRetry}
                  canSolution={canSolution}
                  canNext={canNext}
                  nextReady={over || retrying}
                  loading={loading}
                  onHint={runner.hint}
                  onRetry={runner.retry}
                  onSolution={runner.showSolution}
                  onNext={goNext}
                  onFlip={() => setFlipped((f) => !f)}
                  stepper={<SolutionStepper runner={runner} />}
                  onHelp={help.openHelp}
                />
              </div>
            </Panel>
            {tallyPanel}
          </div>
        }
      />
      <ShortcutHelp open={help.helpOpen} onClose={help.closeHelp} groups={TRAIN_SHORTCUTS} />
    </>
  );
}
