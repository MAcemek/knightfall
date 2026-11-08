import { useCallback, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Icons, PageHeader, Pill } from '../../shared/ui.tsx';
import { useBattle } from './useBattle.ts';
import { Lobby } from './Lobby.tsx';
import { MatchIntro } from './MatchIntro.tsx';
import { BattleGame } from './BattleGame.tsx';
import { EndScreen } from './EndScreen.tsx';

/** Puzzle Battle: real-time head-to-head puzzle race (falls back to a sparring bot when nobody is around). */
export default function BattlePage() {
  const api = useBattle();
  const { state } = api;
  const match = state.match;
  const [introDoneFor, setIntroDoneFor] = useState<string | null>(null);
  const inMatch = state.phase === 'matched' || state.phase === 'playing';
  const showIntro = !!match && inMatch && introDoneFor !== match.roomId;
  const roomId = match?.roomId ?? null;
  const onIntroDone = useCallback(() => setIntroDoneFor(roomId), [roomId]);

  const subtitle =
    state.phase === 'playing'
      ? `vs ${match?.opponent.name ?? 'opponent'}`
      : state.phase === 'ended'
        ? 'Battle over'
        : 'Race a rival through the same puzzles';

  return (
    <>
      <PageHeader
        title="Puzzle Battle"
        subtitle={subtitle}
        icon={Icons.swords('h-6 w-6')}
        right={
          state.phase === 'playing' && match ? (
            <Pill className="hidden bg-ember-500/15 text-ember-300 sm:inline-flex">
              {Icons.bolt('h-3.5 w-3.5')} Live
            </Pill>
          ) : undefined
        }
      />

      {match && inMatch ? (
        <BattleGame key={match.roomId} state={state} match={match} serverNow={api.serverNow} onResult={api.reportResult} onResign={api.resign} onClaim={api.claim} />
      ) : match && state.phase === 'ended' && state.end ? (
        <EndScreen state={state} match={match} onRematch={api.rematch} onNewOpponent={api.findOpponent} onLobby={api.backToLobby} />
      ) : (
        <Lobby api={api} />
      )}

      <AnimatePresence>
        {showIntro && match && (
          <MatchIntro key={match.roomId} me={match.me} opponent={match.opponent} startsAt={match.startsAt} serverNow={api.serverNow} onDone={onIntroDone} />
        )}
      </AnimatePresence>
    </>
  );
}
