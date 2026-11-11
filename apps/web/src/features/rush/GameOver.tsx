import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { burstAt, confetti, PALETTES, sfx, TickerNumber } from '../../shared/fx/index.ts';
import { Button, Icons, Panel, Stat } from '../../shared/ui.tsx';
import { formatSeconds, summarize, type RushModeConfig, type RunCore } from './rushLogic.ts';
import { AttemptTile } from './RunTiles.tsx';
import { ReviewModal } from './ReviewModal.tsx';
import type { EndReason, SaveInfo } from './useRushGame.ts';

const REASON: Record<EndReason, string> = {
  time: "Time's up",
  strikes: 'Three strikes',
  quit: 'Ended early',
};

export function GameOver({ cfg, core, endReason, save, onPlayAgain, onChangeMode }: {
  cfg: RushModeConfig;
  core: RunCore;
  endReason: EndReason | null;
  save: SaveInfo | null;
  onPlayAgain: () => void;
  onChangeMode: () => void;
}) {
  const s = summarize(core);
  const [shown, setShown] = useState(0);
  const [review, setReview] = useState<number | null>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const countSec = Math.min(1.6, 0.5 + core.score * 0.035);

  // Count the score up from zero.
  useEffect(() => {
    const t = setTimeout(() => setShown(core.score), 250);
    return () => clearTimeout(t);
  }, [core.score]);

  // Land the celebration when the count-up finishes (and the save tells us if it's a record).
  useEffect(() => {
    if (!save) return;
    const t = setTimeout(() => {
      if (save.newBest) {
        sfx.win();
        confetti({ count: 140 });
        burstAt(scoreRef.current, { count: 60, colors: PALETTES.ember, power: 11, shape: 'star', size: 10, life: 80 });
      } else if (core.score > 0) {
        sfx.solved();
        burstAt(scoreRef.current, { count: 22, colors: PALETTES.good, power: 6 });
      } else {
        sfx.lose();
      }
    }, 250 + countSec * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);

  // Keyboard: Enter/R = play again, Esc/M = change mode (when no review is open).
  useEffect(() => {
    if (review !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select')) return;
      const k = e.key.toLowerCase();
      if (k === 'enter' || k === 'r') {
        e.preventDefault();
        onPlayAgain();
      } else if (k === 'escape' || k === 'm') {
        e.preventDefault();
        onChangeMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, onPlayAgain, onChangeMode]);

  const newBest = !!save?.newBest;
  const prevBest = save?.prevBest ?? 0;
  const missed = core.attempts.filter((a) => !a.solved).length;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <Panel className="relative overflow-hidden p-5 text-center sm:p-7">
        <div
          className={`pointer-events-none absolute inset-x-0 -top-24 h-72 opacity-70 blur-2xl ${newBest ? 'bg-[radial-gradient(closest-side,rgb(255_154_31/0.45),transparent)]' : 'bg-[radial-gradient(closest-side,rgb(108_196_255/0.18),transparent)]'}`}
        />
        <div className="relative">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-ink-400">
            <span>{cfg.label}</span>
            {endReason && (
              <>
                <span className="h-1 w-1 rounded-full bg-ink-600" />
                <span className={endReason === 'strikes' ? 'text-bad-400' : endReason === 'time' ? 'text-ember-400' : ''}>{REASON[endReason]}</span>
              </>
            )}
          </div>

          <div ref={scoreRef} className="mt-3 inline-block">
            <TickerNumber
              value={shown}
              duration={countSec}
              className={`block font-mono text-[clamp(88px,22vw,148px)] font-black leading-none ${newBest ? 'text-ember-400 drop-shadow-[0_0_40px_rgb(255_154_31/0.55)]' : 'text-ink-100'}`}
            />
          </div>
          <div className="mt-1 text-sm font-semibold text-ink-400">{core.score === 1 ? 'puzzle solved' : 'puzzles solved'}</div>

          <div className="mt-4 flex h-9 items-center justify-center">
            {newBest ? (
              <span
                className="inline-flex animate-pop items-center gap-2 rounded-full bg-gradient-to-r from-ember-400 to-ember-600 px-4 py-1.5 text-sm font-black uppercase tracking-wider text-ink-950 shadow-[0_0_24px_rgb(255_154_31/0.6)]"
                style={{ animationDelay: `${250 + countSec * 1000}ms` }}
              >
                {Icons.trophy('h-4 w-4')} New best!
                {prevBest > 0 && <span className="font-mono normal-case tracking-normal opacity-80">+{core.score - prevBest}</span>}
              </span>
            ) : save ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-ink-400">
                {Icons.trophy('h-4 w-4 text-ember-400')} Personal best <span className="font-mono font-bold text-ink-200">{Math.max(prevBest, core.score)}</span>
              </span>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5 text-left">
            <Stat label="Top rating solved" value={s.highestSolved ?? '–'} accent="text-ember-300" />
            <Stat label="Best combo" value={`×${s.bestCombo}`} accent="text-ember-400" />
            <Stat
              label="Accuracy"
              value={s.accuracy === null ? '–' : `${Math.round(s.accuracy * 100)}%`}
              sub={`${s.solved} of ${s.attempted} correct`}
              accent={s.accuracy !== null && s.accuracy >= 0.8 ? 'text-good-400' : 'text-ink-100'}
            />
            <Stat label="Avg time" value={formatSeconds(s.avgTimeMs)} sub="per puzzle" />
          </div>

          {save?.saved && missed > 0 && (
            <Link
              to="/train/review"
              className="mt-3 flex animate-rise items-center justify-center gap-2 rounded-xl border border-ember-500/30 bg-ember-500/10 px-4 py-2.5 text-sm font-semibold text-ember-300 transition hover:bg-ember-500/15"
            >
              {Icons.layers('h-4 w-4')} {missed} missed puzzle{missed === 1 ? '' : 's'} added to your review queue {Icons.next('h-4 w-4')}
            </Link>
          )}

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Button variant="primary" size="lg" onClick={onPlayAgain} autoFocus className="sm:min-w-48">
              {Icons.bolt('h-5 w-5')} Play again
            </Button>
            <Button size="lg" onClick={onChangeMode}>
              Change mode
            </Button>
          </div>
          <div className="mt-3 hidden text-xs text-ink-500 sm:block">Enter to play again · Esc to change mode</div>
        </div>
      </Panel>

      <Panel className="flex min-h-0 flex-col">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">
            Puzzles <span className="font-mono text-ink-400">({s.attempted})</span>
          </h2>
          {s.attempted > 0 && <span className="text-xs text-ink-400">Tap one to review</span>}
        </div>
        {s.attempted ? (
          <div className="grid max-h-[60vh] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-3 lg:grid-cols-2">
            {core.attempts.map((a, i) => (
              <div key={a.index} style={{ animationDelay: `${Math.min(i, 30) * 25}ms` }} className="[&>*]:[animation-delay:inherit]">
                <AttemptTile attempt={a} onClick={() => setReview(i)} showTime />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-ink-400">
            {Icons.puzzle('h-8 w-8 text-ink-600')}
            <div>No puzzles attempted this run.</div>
          </div>
        )}
      </Panel>

      {review !== null && core.attempts[review] && (
        <ReviewModal attempts={core.attempts} index={review} onIndex={setReview} onClose={() => setReview(null)} />
      )}
    </div>
  );
}
