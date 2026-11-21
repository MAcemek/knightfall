import { useEffect, useRef, useState } from 'react';
import { BATTLE_MAX_STRIKES, rampFor } from '@knightfall/core';
import { burstAt, PALETTES, sfx } from '../../shared/fx/index.ts';
import { Button, Icons, Modal } from '../../shared/ui.tsx';
import { resignText, type BattleState, type MatchInfo } from './battleState.ts';
import { BattleHud } from './BattleHud.tsx';
import { RaceBoard, useTimeUp } from './RaceBoard.tsx';

/**
 * The live battle: the HUD and clinch banner around the shared race board (RaceBoard.tsx).
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
  const [confirmResign, setConfirmResign] = useState(false);
  const myScoreRef = useRef<HTMLDivElement>(null);
  const timeUp = useTimeUp(match.endsAt, serverNow);
  const out = state.me.strikes >= BATTLE_MAX_STRIKES;
  const ramp = rampFor(match.settings?.level);

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

  return (
    <>
      <RaceBoard
        seed={match.seed}
        ramp={ramp}
        playing={playing}
        timeUp={timeUp}
        strikes={state.me.strikes}
        history={state.history}
        onResult={onResult}
        scoreRef={myScoreRef}
        waitingText="Waiting for your opponent to finish…"
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
        sideFooter={
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
        }
      />

      <Modal open={confirmResign} onClose={() => setConfirmResign(false)}>
        <h2 className="text-xl font-extrabold">Resign this battle?</h2>
        <p className="mt-2 text-sm text-ink-300">
          {resignText(match.friendly, match.series)}
        </p>
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
