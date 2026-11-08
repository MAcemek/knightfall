import { useEffect, useRef, useState } from 'react';
import { BATTLE_MAX_STRIKES, type Puzzle } from '@knightfall/core';
import { Board } from '../../shared/Board/index.ts';
import { PuzzleBoard, PuzzlePrompt, ProgressDots, usePuzzleRunner } from '../../shared/PuzzlePlayer/index.ts';
import { prefetchSequence, sequencePuzzle } from '../../shared/puzzleSource.ts';
import { burstAt, PALETTES, sfx } from '../../shared/fx/index.ts';
import { Button, GameLayout, Icons, Modal, Panel, Pill } from '../../shared/ui.tsx';
import { BATTLE_RAMP, type BattleState, type MatchInfo } from './battleState.ts';
import { BattleHud } from './BattleHud.tsx';
import { PuzzleChips } from './PuzzleChips.tsx';

const NEXT_AFTER_SOLVE_MS = 380;
const NEXT_AFTER_MISS_MS = 900;

/**
 * The live battle: the shared puzzle sequence on the board, the HUD on top, and a side panel.
 * Mount with key={roomId} so every battle starts fresh.
 */
export function BattleGame({ state, match, serverNow, onResult, onResign, onClaim }: {
  state: BattleState;
  match: MatchInfo;
  serverNow: () => number;
  onResult: (puzzle: { id: string; rating: number }, solved: boolean) => void;
  onResign: () => void;
  onClaim: () => void;
}) {
  const playing = state.phase === 'playing';
  const [loadIndex, setLoadIndex] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const streak = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const myScoreRef = useRef<HTMLDivElement>(null);
  const strikesRef = useRef(state.me.strikes);
  strikesRef.current = state.me.strikes;

  // Lock the board the moment the server clock runs out (the server's 'end' follows right after).
  const [timeUp, setTimeUp] = useState(false);
  useEffect(() => {
    if (!match.endsAt) return;
    const t = setTimeout(() => setTimeUp(true), Math.max(0, match.endsAt - serverNow()));
    return () => clearTimeout(t);
  }, [match.endsAt, serverNow]);
  const out = state.me.strikes >= BATTLE_MAX_STRIKES;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Load the puzzle for the current index (identical for both players: same seed + index).
  useEffect(() => {
    let alive = true;
    setLoadError(null);
    sequencePuzzle(match.seed, loadIndex, BATTLE_RAMP)
      .then((p) => alive && setPuzzle({ ...p })) // fresh identity so the runner always resets
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : 'Could not load puzzles.'));
    prefetchSequence(match.seed, loadIndex + 1, 3, BATTLE_RAMP);
    return () => {
      alive = false;
    };
  }, [match.seed, loadIndex]);

  const runner = usePuzzleRunner(playing ? puzzle : null, {
    solvedSound: false,
    autoRetry: false,
    replyDelay: 240,
    introDelay: 340,
    onComplete: ({ puzzle: p, solved }) => {
      onResult({ id: p.id, rating: p.rating }, solved);
      if (solved) {
        streak.current++;
        sfx.combo(streak.current);
        burstAt(myScoreRef.current, { colors: streak.current >= 5 ? PALETTES.ember : PALETTES.good, count: 18 + Math.min(30, streak.current * 3), power: 6 });
        if (streak.current > 0 && streak.current % 5 === 0) sfx.sparkle();
      } else {
        streak.current = 0;
        sfx.strike();
      }
      const strikesAfter = strikesRef.current + (solved ? 0 : 1);
      if (strikesAfter >= BATTLE_MAX_STRIKES) return;
      timers.current.push(setTimeout(() => setLoadIndex((i) => i + 1), solved ? NEXT_AFTER_SOLVE_MS : NEXT_AFTER_MISS_MS));
    },
  });

  const locked = out || timeUp;
  // Opponent (a bot) is out of lives: once you're ahead the win is yours — claim it or keep solving.
  const oppOut = state.opp.strikes >= BATTLE_MAX_STRIKES;
  const clinched = playing && oppOut && !out && !timeUp && state.me.solved > state.opp.solved;
  const chasing = playing && oppOut && !out && !timeUp && !clinched;
  const wasClinched = useRef(false);
  useEffect(() => {
    if (clinched && !wasClinched.current) {
      sfx.win();
      burstAt(myScoreRef.current, { colors: PALETTES.party, count: 40, power: 8, shape: 'star' });
    }
    wasClinched.current = clinched;
  }, [clinched]);
  const lastSolved = state.history.at(-1)?.solved;

  const board = (
    <div className="relative">
      {playing ? (
        <PuzzleBoard runner={runner}>
          {locked && <LockOverlay out={out} />}
        </PuzzleBoard>
      ) : (
        <Board fen={puzzle?.fen ?? '8/8/8/8/8/8/8/8 w - - 0 1'} orientation={sideToMoveOrientation(puzzle)} />
      )}
      {loadError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-ink-950/85 p-6 text-center text-sm font-semibold text-bad-400">{loadError}</div>
      )}
    </div>
  );

  return (
    <>
      <GameLayout
        top={
          <>
          <BattleHud
            me={match.me}
            opponent={match.opponent}
            myScore={state.me}
            oppScore={state.opp}
            oppTick={state.oppTick}
            endsAt={match.endsAt}
            serverNow={serverNow}
            live={playing}
            myScoreRef={myScoreRef}
          />
          {clinched && <ClinchBanner opponent={match.opponent.name} lead={state.me.solved - state.opp.solved} onClaim={onClaim} />}
          {chasing && (
            <div className="mb-3 animate-pop rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-2.5 text-sm font-semibold text-sky-400">
              {match.opponent.name} is out of lives — solve {state.opp.solved - state.me.solved + 1} more to clinch the win!
            </div>
          )}
          </>
        }
        board={board}
        side={
          <Panel className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <PuzzlePrompt runner={runner} idleText="Get ready…" />
              {puzzle && playing && <Pill className="font-mono">#{loadIndex + 1} · {puzzle.rating}</Pill>}
            </div>
            <div className="flex min-h-2 items-center justify-between gap-2">
              <ProgressDots runner={runner} />
              {lastSolved !== undefined && streak.current >= 2 && (
                <span key={streak.current} className="animate-pop text-sm font-black text-ember-400">
                  {Icons.flame('inline h-4 w-4 -mt-0.5')} {streak.current} in a row
                </span>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">This battle</div>
              {state.history.length ? (
                <PuzzleChips history={state.history} />
              ) : (
                <div className="text-sm text-ink-400">Solve fast — every puzzle counts. A miss costs a strike.</div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-ink-700/60 pt-3">
              <div className="min-w-0 text-sm">
                <div className="text-xs text-ink-400">Opponent</div>
                <div className="truncate font-semibold">
                  {match.opponent.name} <span className="font-mono text-ink-400">({match.opponent.rating})</span>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setConfirmResign(true)}>
                {Icons.x('h-4 w-4')} Resign
              </Button>
            </div>
          </Panel>
        }
      />

      <Modal open={confirmResign} onClose={() => setConfirmResign(false)}>
        <h2 className="text-xl font-extrabold">Resign this battle?</h2>
        <p className="mt-2 text-sm text-ink-300">Your opponent takes the win and your battle rating drops.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmResign(false)}>
            Keep playing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmResign(false);
              onResign();
            }}
          >
            Resign
          </Button>
        </div>
      </Modal>
    </>
  );
}

function sideToMoveOrientation(p: Puzzle | null): 'white' | 'black' {
  if (!p) return 'white';
  const stm = p.fen.split(' ')[1];
  // Lichess puzzles: the side to move in the FEN plays the setup move; the solver is the other side.
  const solverWhite = p.opponentFirst ? stm === 'b' : stm === 'w';
  return solverWhite ? 'white' : 'black';
}

function ClinchBanner({ opponent, lead, onClaim }: { opponent: string; lead: number; onClaim: () => void }) {
  return (
    <div className="mb-3 flex animate-pop flex-wrap items-center gap-3 rounded-xl border border-good-500/40 bg-gradient-to-r from-good-500/20 to-ember-500/10 px-4 py-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-good-500/25 text-good-400">{Icons.trophy('h-6 w-6')}</div>
      <div className="min-w-0 flex-1">
        <div className="font-extrabold text-good-400">Victory secured!</div>
        <div className="text-xs text-ink-300">
          {opponent} is out of lives and you lead by {lead}. Claim it now or keep solving to pad your score.
        </div>
      </div>
      <Button variant="good" size="sm" onClick={onClaim}>
        {Icons.trophy('h-4 w-4')} Claim win
      </Button>
    </div>
  );
}

function LockOverlay({ out }: { out: boolean }) {
  return (
    <div className="absolute inset-0 z-50 flex animate-pop flex-col items-center justify-center gap-2 bg-ink-950/75 p-6 text-center backdrop-blur-[2px]">
      <div className={`flex h-14 w-14 items-center justify-center rounded-full ${out ? 'bg-bad-500/20 text-bad-400' : 'bg-ember-500/20 text-ember-400'}`}>
        {out ? Icons.x('h-8 w-8') : Icons.clock('h-8 w-8')}
      </div>
      <div className="text-xl font-extrabold">{out ? 'Out of strikes' : "Time's up!"}</div>
      <div className="text-sm text-ink-300">{out ? 'Waiting for your opponent to finish…' : 'Tallying the final score…'}</div>
      <div className="mt-1 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-ink-400" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}
