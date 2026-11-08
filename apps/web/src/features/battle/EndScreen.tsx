import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { burstAt, confetti, FloatingDelta, PALETTES, sfx, TickerNumber } from '../../shared/fx/index.ts';
import { Button, Icons, Panel } from '../../shared/ui.tsx';
import type { BattleState, EndInfo, MatchInfo } from './battleState.ts';
import { Kbd } from './Lobby.tsx';
import { PuzzleChips } from './PuzzleChips.tsx';
import { isTypingTarget } from './util.ts';

const TITLES: Record<EndInfo['result'], { title: string; cls: string; glow: string }> = {
  win: { title: 'Victory!', cls: 'text-good-400', glow: 'from-good-500/25' },
  loss: { title: 'Defeat', cls: 'text-bad-400', glow: 'from-bad-500/20' },
  draw: { title: 'Draw', cls: 'text-ink-100', glow: 'from-sky-400/15' },
};

function reasonText(end: EndInfo): string {
  switch (end.reason) {
    case 'time':
      return "Time's up";
    case 'strikes':
      return end.you.strikes >= 3 && end.opponent.strikes >= 3 ? 'Both players struck out' : end.you.strikes >= 3 ? 'You struck out' : 'Your opponent struck out';
    case 'opponent-left':
      return 'Your opponent left the battle';
    case 'claimed':
      return 'Win claimed — your opponent was out of lives';
    case 'resigned':
      return 'You resigned';
  }
}

/** Result screen: verdict + effects, final scores, Elo change, rematch / new opponent / lobby. */
export function EndScreen({ state, match, onRematch, onNewOpponent, onLobby }: {
  state: BattleState;
  match: MatchInfo;
  onRematch: () => void;
  onNewOpponent: () => void;
  onLobby: () => void;
}) {
  const end = state.end!;
  const t = TITLES[end.result];
  const delta = end.ratingAfter - end.ratingBefore;
  const [shownRating, setShownRating] = useState(end.ratingBefore);
  const [deltaTrigger, setDeltaTrigger] = useState<number | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  // Effects once per result.
  useEffect(() => {
    if (end.result === 'win') {
      sfx.win();
      confetti();
      setTimeout(() => burstAt(titleRef.current, { colors: PALETTES.good, count: 50, power: 10, shape: 'star' }), 120);
    } else if (end.result === 'loss') {
      sfx.lose();
    } else {
      sfx.sparkle();
    }
    const t1 = setTimeout(() => {
      setShownRating(end.ratingAfter);
      setDeltaTrigger(Date.now());
    }, 650);
    return () => clearTimeout(t1);
  }, [end]);

  // Keyboard: R = rematch, N = new opponent, Esc = lobby.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'r') onRematch();
      else if (k === 'n') onNewOpponent();
      else if (k === 'escape') onLobby();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRematch, onNewOpponent, onLobby]);

  const rematchLabel =
    state.rematch === 'requested' ? 'Waiting for opponent…' : state.rematch === 'offered' ? 'Opponent wants a rematch!' : state.rematch === 'unavailable' ? 'Rematch unavailable' : 'Rematch';

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Panel className="relative overflow-hidden p-0">
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b ${t.glow} to-transparent`} />
        <div className="relative flex flex-col items-center px-5 pb-6 pt-8 text-center sm:px-8">
          <motion.div
            ref={titleRef}
            initial={{ scale: 0.4, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 15 }}
            className={`text-5xl font-black tracking-tight sm:text-6xl ${t.cls}`}
          >
            {t.title}
          </motion.div>
          <div className="mt-1 text-sm font-semibold text-ink-400">{reasonText(end)}</div>

          {/* Scoreline */}
          <div className="mt-6 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3">
            <ScoreCol name={match.me.name} label="You" score={end.you.solved} strikes={end.you.strikes} tone="text-ember-400" winner={end.result === 'win'} />
            <div className="text-2xl font-black text-ink-500">–</div>
            <ScoreCol name={match.opponent.name} label="Opponent" score={end.opponent.solved} strikes={end.opponent.strikes} tone="text-sky-400" winner={end.result === 'loss'} />
          </div>

          {/* Rating */}
          <div className="mt-6 flex items-center gap-4 rounded-2xl bg-ink-800/70 px-5 py-3">
            <div className="text-left">
              <div className="text-xs font-bold uppercase tracking-wider text-ink-400">Battle rating</div>
              <div className="relative font-mono text-3xl font-black">
                <TickerNumber value={shownRating} duration={0.9} />
                <FloatingDelta delta={delta} trigger={deltaTrigger} className="-top-5" />
              </div>
            </div>
            <div className={`rounded-lg px-2.5 py-1 font-mono text-lg font-bold ${delta > 0 ? 'bg-good-500/15 text-good-400' : delta < 0 ? 'bg-bad-500/15 text-bad-400' : 'bg-ink-700 text-ink-300'}`}>
              {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0'}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 grid w-full gap-2 sm:grid-cols-3">
            <Button
              variant={state.rematch === 'offered' ? 'good' : 'primary'}
              onClick={onRematch}
              disabled={state.rematch === 'requested' || state.rematch === 'unavailable'}
              className={state.rematch === 'offered' ? 'animate-pulse' : ''}
            >
              {state.rematch === 'requested' ? <Spinner /> : Icons.retry('h-4 w-4')}
              {rematchLabel}
            </Button>
            <Button variant="secondary" onClick={onNewOpponent}>
              {Icons.swords('h-4 w-4')} New opponent
            </Button>
            <Button variant="ghost" onClick={onLobby}>
              Back to lobby
            </Button>
          </div>
          <div className="mt-3 hidden gap-3 text-xs text-ink-500 sm:flex">
            <span>
              <Kbd>R</Kbd> rematch
            </span>
            <span>
              <Kbd>N</Kbd> new opponent
            </span>
            <span>
              <Kbd>Esc</Kbd> lobby
            </span>
          </div>
        </div>

        <div className="border-t border-ink-700/60 px-5 py-4 sm:px-8">
          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-ink-400">
            <span>Your puzzles</span>
            <span className="font-mono normal-case tracking-normal">
              {state.history.filter((p) => p.solved).length}/{state.history.length} solved
            </span>
          </div>
          {state.history.length ? <PuzzleChips history={state.history} links /> : <div className="text-sm text-ink-400">No puzzles finished this time.</div>}
        </div>
      </Panel>
    </div>
  );
}

function ScoreCol({ name, label, score, strikes, tone, winner }: { name: string; label: string; score: number; strikes: number; tone: string; winner: boolean }) {
  // Count up from zero for a satisfying reveal.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(score), 180);
    return () => clearTimeout(t);
  }, [score]);
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-400">{label}</div>
      <div className="truncate text-sm font-semibold">{name}</div>
      <div className={`font-mono text-5xl font-black ${tone} ${winner ? 'drop-shadow-[0_0_18px_currentColor]' : ''}`}>
        <TickerNumber value={shown} duration={0.8} />
      </div>
      <div className="mt-1 flex justify-center gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`flex h-4 w-4 items-center justify-center rounded text-[10px] font-black ${i < strikes ? 'bg-bad-500 text-white' : 'bg-ink-700 text-ink-500'}`}>
            ✗
          </span>
        ))}
      </div>
    </div>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}
