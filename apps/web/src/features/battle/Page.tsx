import { useCallback, useLayoutEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { formatCode } from '@knightfall/core';
import { Icons, PageHeader, Pill } from '../../shared/ui.tsx';
import { useClub } from '../../shared/battle/clubStore.ts';
import { useBattle } from './useBattle.ts';
import { Lobby } from './Lobby.tsx';
import { MatchIntro } from './MatchIntro.tsx';
import { BattleGame } from './BattleGame.tsx';
import { EndScreen } from './EndScreen.tsx';
import { ClubRoom } from './ClubRoom.tsx';
import { battleViewKey } from './battleView.ts';

/** Puzzle Battle: real-time head-to-head puzzle race (falls back to a sparring bot when nobody is around). */
export default function BattlePage() {
  const api = useBattle();
  const { state } = api;
  const clubState = useClub();
  const club = clubState.room;
  const match = state.match;
  const [introDoneFor, setIntroDoneFor] = useState<string | null>(null);
  const inMatch = state.phase === 'matched' || state.phase === 'playing';
  const showIntro = !!match && inMatch && introDoneFor !== match.roomId;
  const roomId = match?.roomId ?? null;
  const onIntroDone = useCallback(() => setIntroDoneFor(roomId), [roomId]);

  const subtitle = club
    ? `Club room ${formatCode(club.code)}`
    : state.phase === 'playing'
      ? `vs ${match?.opponent.name ?? 'opponent'}`
      : state.phase === 'ended'
        ? 'Battle over'
        : 'Race a rival through the same puzzles';

  // The lobby turns into the game on the same route, so the router does not reset the scroll: do it per screen.
  const viewKey = battleViewKey(state, club);
  // Block body on purpose: window.scrollTo returns a Promise in current Chrome, and an effect must return a cleanup function or nothing.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [viewKey]);
  // While a match or a club race is on screen the title only stays for screen readers below lg (the phone needs the room).
  const gameOn = viewKey.startsWith('game:') || viewKey === 'club-race';

  return (
    <>
      <PageHeader
        className={gameOn ? 'max-lg:sr-only' : ''}
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

      {club ? (
        <>
          {clubState.reconnecting && (
            <div data-testid="club-reconnecting" role="status" className="mb-3 rounded-xl border border-ember-400/30 bg-ember-400/10 px-4 py-2.5 text-sm font-semibold text-ember-300">
              Connection lost. Reconnecting to your room…
            </div>
          )}
          <ClubRoom room={club} />
        </>
      ) : match && inMatch ? (
        <BattleGame key={match.roomId} state={state} match={match} serverNow={api.serverNow} onResult={api.reportResult} onResign={api.resign} onClaim={api.claim} />
      ) : match && state.phase === 'ended' && state.end ? (
        <EndScreen state={state} match={match} onRematch={api.rematch} onNewOpponent={api.findOpponent} onLobby={api.backToLobby} />
      ) : (
        <Lobby api={api} />
      )}

      <AnimatePresence>
        {showIntro && match && (
          <MatchIntro key={match.roomId} me={match.me} opponent={match.opponent} startsAt={match.startsAt} serverNow={api.serverNow} onDone={onIntroDone} settings={match.settings} series={match.series} />
        )}
      </AnimatePresence>
    </>
  );
}
