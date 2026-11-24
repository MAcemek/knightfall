import type { BattleState } from './battleState.ts';
import type { ClubRoom } from './clubLogic.ts';

/**
 * Which screen the Battle page shows, as a key. The page scrolls to the top whenever the key changes (the lobby
 * turns into the game on the same route, so the router never resets the scroll). The countdown and the race of
 * one club race share a key, and so does a spectator; a new best-of-3 game has a new room id, so a new key.
 */
export function battleViewKey(state: Pick<BattleState, 'phase' | 'match' | 'end'>, club: Pick<ClubRoom, 'phase'> | null): string {
  if (club) {
    if (club.phase === 'lobby') return 'club-lobby';
    return club.phase === 'ended' ? 'club-end' : 'club-race';
  }
  const { match } = state;
  if (match && (state.phase === 'matched' || state.phase === 'playing')) return `game:${match.roomId}`;
  if (match && state.phase === 'ended' && state.end) return `end:${match.roomId}`;
  return 'lobby';
}
