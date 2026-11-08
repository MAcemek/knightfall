import { useEffect, useRef, useState } from 'react';
import { usePuzzleRunner, type RunnerStatus } from '../../shared/PuzzlePlayer/index.ts';
import { burstAt, confetti, PALETTES, sfx } from '../../shared/fx/index.ts';
import { useProfile } from '../../shared/profile.ts';
import { Button, GameLayout, Icons, PageHeader, Panel } from '../../shared/ui.tsx';
import { Controls, Toggle } from './components/Controls.tsx';
import { HistoryStrip } from './components/HistoryStrip.tsx';
import { isFinished, PuzzleCard } from './components/PuzzleCard.tsx';
import { RatingCard } from './components/RatingCard.tsx';
import { burstFromSquare, TrainerBoard, type BoardGlow } from './components/TrainerBoard.tsx';
import { useHotkeys } from './useHotkeys.ts';
import { useRatedSession } from './useRatedSession.ts';

const AUTO_NEXT_KEY = 'kf:puzzles:autoNext';

function readAutoNext(): boolean {
  try {
    return localStorage.getItem(AUTO_NEXT_KEY) === '1';
  } catch {
    return false;
  }
}

/** The visible element among duplicates (mobile strip vs desktop card). */
function visible(selector: string): Element | null {
  for (const el of document.querySelectorAll(selector)) if ((el as HTMLElement).offsetParent !== null) return el;
  return null;
}

export function RatedTrainer() {
  const session = useRatedSession();
  const runner = usePuzzleRunner(session.puzzle, { onComplete: session.onComplete });
  const profile = useProfile();
  const boardWrap = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);
  const [autoNext, setAutoNext] = useState(readAutoNext);

  const { status, retrying } = runner;
  const finished = isFinished(status);

  // New puzzle → unflip.
  useEffect(() => setFlipped(false), [session.puzzle]);

  // Outcome effects: glow + burst from the last-move square.
  const prevStatus = useRef<RunnerStatus>('idle');
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (status === 'solved' && prev !== 'solved') {
      const big = !retrying && session.mode === 'rated' && runner.hintsUsed === 0;
      burstFromSquare(boardWrap.current, runner.lastMove?.[1], 'good', big);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const glow: BoardGlow = status === 'solved' ? 'good' : status === 'failed' || status === 'solution' ? 'bad' : null;

  // Streak & rating milestones.
  useEffect(() => {
    const ev = session.streakEvent;
    if (!ev) return;
    const flame = visible('[data-streak-flame]');
    if (ev.incremented) burstAt(flame, { count: ev.milestone ? 40 : 12, colors: PALETTES.ember, power: ev.milestone ? 8 : 4, shape: ev.milestone ? 'star' : undefined });
    if (ev.milestone) setTimeout(() => sfx.sparkle(), 120);
    if (ev.newBest) setTimeout(() => confetti({ count: 60 }), 200);
  }, [session.streakEvent]);

  useEffect(() => {
    const r = session.result;
    if (r?.kind === 'gain') burstAt(visible('[data-rating-number]'), { count: 14, colors: PALETTES.good, power: 4, size: 4 });
  }, [session.result]);

  // Auto-next after a solve.
  useEffect(() => {
    if (!autoNext || status !== 'solved' || session.mode !== 'rated' || retrying) return;
    const t = setTimeout(() => void session.next(), 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNext, status, session.mode, retrying]);

  const setAuto = (v: boolean) => {
    setAutoNext(v);
    try {
      localStorage.setItem(AUTO_NEXT_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const canHint = status === 'player';
  const canRetry = status === 'failed';
  const canSolution = status === 'player' || status === 'opponent' || status === 'failed';
  // After a miss the solver keeps trying (unrated), but can move on at any time.
  const canNext = finished || retrying || session.mode === 'replay' || session.error !== null;
  const goNext = () => void session.next();
  const flip = () => setFlipped((f) => !f);

  useHotkeys({
    h: () => (canHint ? runner.hint() : false),
    r: () => (canRetry ? runner.retry() : false),
    s: () => (canSolution ? runner.showSolution() : false),
    f: () => flip(),
    enter: () => (canNext && !session.loading ? goNext() : false),
    ' ': () => (canNext && !session.loading ? goNext() : false),
  });

  const delta = session.result && session.mode === 'rated' && session.result.kind !== 'hinted' ? session.result.delta : null;
  const ratingProps = {
    rating: profile ? Math.round(profile.puzzleRating.rating) : undefined,
    rd: profile?.puzzleRating.rd,
    streak: profile?.puzzleStreak,
    delta,
    deltaTrigger: session.streakEvent?.key,
    streakEvent: session.streakEvent,
  };

  return (
    <>
      <PageHeader title="Puzzles" subtitle="Rated tactics matched to your level" icon={Icons.puzzle('h-6 w-6')} />
      <GameLayout
        top={
          <div className="mb-3 lg:hidden">
            <RatingCard {...ratingProps} compact />
          </div>
        }
        board={
          <div ref={boardWrap} className="relative">
            <TrainerBoard runner={runner} flipped={flipped} glow={glow}>
              {session.loading && status === 'idle' && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink-950/40 backdrop-blur-[1px]">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-ink-600 border-t-ember-400" />
                </div>
              )}
            </TrainerBoard>
          </div>
        }
        side={
          <div className="flex flex-col gap-3">
            <div className="hidden lg:block">
              <RatingCard {...ratingProps} />
            </div>
            {session.abandonedDelta !== null && (
              <div className="animate-pop rounded-xl border border-bad-500/30 bg-bad-500/10 px-4 py-2.5 text-sm text-bad-400">
                Your last puzzle was left unfinished and counted as a miss
                {session.abandonedDelta !== 0 && <span className="font-mono font-bold"> ({session.abandonedDelta > 0 ? '+' : '−'}{Math.abs(session.abandonedDelta)})</span>}.
              </div>
            )}
            {session.error ? (
              <Panel className="space-y-3">
                <p className="font-semibold text-bad-400">{session.error}</p>
                <Button variant="primary" onClick={goNext}>
                  {Icons.retry('h-4 w-4')} Try again
                </Button>
              </Panel>
            ) : null}
            <PuzzleCard runner={runner} mode={session.mode} result={session.result}>
              <div className="mt-4 border-t border-ink-700/60 pt-4">
                <Controls
                  canHint={canHint}
                  canRetry={canRetry}
                  canSolution={canSolution}
                  canNext={canNext}
                  nextReady={finished || retrying}
                  loading={session.loading}
                  onHint={runner.hint}
                  onRetry={runner.retry}
                  onSolution={runner.showSolution}
                  onNext={goNext}
                  onFlip={flip}
                  nextLabel={session.mode === 'replay' ? 'Back to rated' : 'Next puzzle'}
                  extra={<Toggle checked={autoNext} onChange={setAuto} label="Auto-next" />}
                />
                {(status === 'failed' || (retrying && status !== 'solved')) && session.mode === 'rated' && (
                  <p className="mt-3 text-center text-xs text-ink-400">Retries are for practice and don't change your rating.</p>
                )}
              </div>
            </PuzzleCard>
            <HistoryStrip
              activeId={session.mode === 'replay' ? session.puzzle?.id : undefined}
              locked={!canNext}
              onReplay={(a) => void session.replay(a.puzzleId, a.puzzleRating)} />
          </div>
        }
      />
    </>
  );
}
