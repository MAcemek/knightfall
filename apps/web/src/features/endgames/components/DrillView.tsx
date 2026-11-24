import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Board, type BoardArrow, type BoardMark } from '../../../shared/Board/index.ts';
import { Button, GameLayout, Icons, PageHeader, Panel, Pill } from '../../../shared/ui.tsx';
import { failureMessage } from '../endgameLogic.ts';
import { ENDGAMES, type EndgamePosition } from '../positions.ts';
import { useEndgameProgress } from '../progressStore.ts';
import { useEndgameDrill } from '../useEndgameDrill.ts';

const goalText = (p: EndgamePosition) =>
  p.goal === 'win'
    ? `Checkmate the ${p.side === 'w' ? 'black' : 'white'} king. Every move you make must keep the win.`
    : `Hold the draw for ${p.holdMoves} moves, or until the game ends. Do not lose.`;

/** /train/endgames/:id: one drill against the tablebase. */
export function DrillView({ position }: { position: EndgamePosition }) {
  const navigate = useNavigate();
  const { state, play, undo, restart, retry } = useEndgameDrill(position);
  const progress = useEndgameProgress();
  const [hintFor, setHintFor] = useState<string | null>(null);
  const showHint = hintFor === position.id;

  const next = ENDGAMES[(ENDGAMES.findIndex((p) => p.id === position.id) + 1) % ENDGAMES.length]!;
  const best = progress?.[position.id]?.best;
  const { status } = state;

  const mark: BoardMark | null = state.status === 'slip' && state.lastMove ? { square: state.lastMove[1], kind: 'wrong', key: state.moves } : null;
  const arrows: BoardArrow[] = state.arrow ? [{ from: state.arrow[0], to: state.arrow[1], color: 'green' }] : [];

  return (
    <>
      <PageHeader
        compact
        title={position.title}
        subtitle={goalText(position)}
        icon={Icons.trophy('h-6 w-6')}
        right={
          <Link to="/train/endgames" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition hover:text-ink-100">
            ← Endgames
          </Link>
        }
      />
      <GameLayout
        board={
          <Board
            fen={state.fen}
            orientation={position.side === 'w' ? 'white' : 'black'}
            interactive={status === 'playing'}
            movableColor={position.side}
            lastMove={state.lastMove}
            mark={mark}
            arrows={arrows}
            onMove={play}
            positionKey={`${position.id}:${state.run}`}
            annotationKey={`${position.id}:${state.run}`}
          />
        }
        side={
          <Panel className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill className={position.goal === 'win' ? 'text-good-400' : 'text-ember-400'}>{position.goal === 'win' ? 'Win' : 'Hold the draw'}</Pill>
              <Pill>{position.side === 'w' ? 'You play White' : 'You play Black'}</Pill>
              <Pill className="font-mono">Moves {state.moves}</Pill>
            </div>
            <p className="text-sm text-ink-300">{goalText(position)}</p>

            {(status === 'loading' || status === 'thinking') && (
              <p role="status" className="min-h-6 text-sm font-semibold text-ink-400">
                {status === 'loading' ? 'Loading the tablebase…' : 'Opponent is thinking…'}
              </p>
            )}
            {status === 'playing' && <p className="min-h-6 text-sm font-semibold text-ink-100">Your move.</p>}

            {status === 'offline' && (
              <div role="alert" className="space-y-3 rounded-xl border border-bad-500/40 bg-bad-500/10 p-3">
                <p className="text-sm font-bold text-bad-400">{failureMessage(state.failure)}</p>
                <Button variant="primary" className="w-full" onClick={retry}>
                  {Icons.retry('h-4 w-4')} Try again
                </Button>
              </div>
            )}

            {status === 'slip' && state.slip && (
              <div role="alert" className="space-y-3 rounded-xl border border-bad-500/40 bg-bad-500/10 p-3">
                <p className="text-sm font-bold text-bad-400">{state.slip.message}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="primary" onClick={() => undo(false)}>
                    {Icons.retry('h-4 w-4')} Undo
                  </Button>
                  <Button onClick={() => undo(true)}>
                    {Icons.eye('h-4 w-4')} Show best
                  </Button>
                </div>
              </div>
            )}

            {status === 'solved' && (
              <div role="status" className="space-y-3 rounded-xl border border-good-500/40 bg-good-500/10 p-3">
                <p className="text-sm font-bold text-good-400">
                  {position.goal === 'win' ? 'Checkmate.' : 'Held.'} {state.moves} moves{best && best < state.moves ? ` · your best is ${best}` : ''}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="good" onClick={() => navigate(`/train/endgames/${next.id}`)}>
                    Next {Icons.next('h-4 w-4')}
                  </Button>
                  <Button onClick={restart}>
                    {Icons.retry('h-4 w-4')} Again
                  </Button>
                </div>
              </div>
            )}

            {status !== 'solved' && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setHintFor(showHint ? null : position.id)}>
                  {Icons.bulb('h-4 w-4')} {showHint ? 'Hide hint' : 'Hint'}
                </Button>
                <Button size="sm" variant="ghost" disabled={status === 'loading' || status === 'offline'} onClick={restart}>
                  {Icons.retry('h-4 w-4')} Restart
                </Button>
              </div>
            )}
            {showHint && status !== 'solved' && <p className="rounded-xl bg-ink-800/70 p-3 text-sm text-ink-300">{position.hint}</p>}
          </Panel>
        }
      />
    </>
  );
}
