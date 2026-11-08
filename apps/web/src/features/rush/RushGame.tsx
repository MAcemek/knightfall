import { useEffect, useState } from 'react';
import type { RushMode } from '../../shared/db.ts';
import { PuzzleBoard, PuzzlePrompt } from '../../shared/PuzzlePlayer/index.ts';
import { Button, GameLayout, Icons, PageHeader, Panel, Pill } from '../../shared/ui.tsx';
import { CountdownOverlay, EndingOverlay, GoFlash, LoadErrorOverlay, ResultFlash } from './BoardOverlays.tsx';
import { GameOver } from './GameOver.tsx';
import { RushHud } from './RushHud.tsx';
import { RunTiles } from './RunTiles.tsx';
import { useRushGame } from './useRushGame.ts';

/** Two-step "End run" so a stray click can't throw away a run (there is no pause in a race). */
function EndRunButton({ onQuit, disabled }: { onQuit: () => void; disabled: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      size="sm"
      variant={armed ? 'danger' : 'ghost'}
      disabled={disabled}
      className="w-full"
      onClick={() => (armed ? onQuit() : setArmed(true))}
    >
      {armed ? 'Tap again to end the run' : 'End run'}
    </Button>
  );
}

/** One run of Puzzle Rush, from countdown to results. Remount (new key) to play again. */
export function RushGame({ mode, onPlayAgain, onChangeMode }: { mode: RushMode; onPlayAgain: () => void; onChangeMode: () => void }) {
  const g = useRushGame(mode);
  const { cfg, phase, runner, core } = g;

  if (phase === 'over') {
    return <GameOver cfg={cfg} core={core} endReason={g.endReason} save={g.save} onPlayAgain={onPlayAgain} onChangeMode={onChangeMode} />;
  }

  const live = phase === 'playing';
  const current =
    live && runner.puzzle && !core.attempts.some((a) => a.index === g.currentIndex) ? { rating: runner.puzzle.rating, index: g.currentIndex } : null;

  const board = (
    <div className="mx-auto w-full lg:max-w-[calc(100dvh-15rem)]">
      <RushHud
        cfg={cfg}
        core={core}
        remainingMs={g.remainingMs}
        elapsedMs={g.elapsedMs}
        live={live}
        solveKey={g.solveKey}
        milestoneKey={g.milestoneKey}
        strikeKey={g.strikeKey}
      />
      <PuzzleBoard runner={runner}>
        {g.flash && <ResultFlash kind={g.flash.kind} flashKey={g.flash.key} />}
        {phase === 'countdown' && <CountdownOverlay count={g.count} label={cfg.label} />}
        {live && g.showGo && <GoFlash />}
        {phase === 'ending' && g.endReason && <EndingOverlay reason={g.endReason} />}
        {live && g.error && <LoadErrorOverlay message={g.error} onRetry={g.retryLoad} />}
      </PuzzleBoard>
    </div>
  );

  const side = (
    <Panel className="space-y-4">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <PuzzlePrompt runner={runner} idleText="Get ready…" />
        {runner.puzzle && live && (
          <Pill key={runner.puzzle.id} className="animate-pop font-mono">
            {runner.puzzle.rating}
          </Pill>
        )}
      </div>
      <RunTiles attempts={core.attempts} current={current} />
      <EndRunButton onQuit={g.quit} disabled={!live} />
    </Panel>
  );

  return (
    <>
      <div className="hidden lg:block">
        <PageHeader
          title="Puzzle Rush"
          subtitle={cfg.blurb}
          icon={Icons.bolt('h-6 w-6')}
          right={<Pill className="px-3 py-1 text-sm">{cfg.label}</Pill>}
        />
      </div>
      <GameLayout board={board} side={side} />
    </>
  );
}
