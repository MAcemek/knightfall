import { GameScreen } from './GameScreen.tsx';
import { Lobby } from './Lobby.tsx';
import { useBotGame } from './useBotGame.ts';

/**
 * Slow training games against a limited-strength Stockfish, mounted at /play/*.
 * Every move you make is held on the board until you have ticked the blunder check.
 */
export default function PlayPage() {
  const api = useBotGame();
  if (!api.loaded) return null;
  return api.game ? <GameScreen key={api.game.id} api={api} /> : <Lobby api={api} />;
}
