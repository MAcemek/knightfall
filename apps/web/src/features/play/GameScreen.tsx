import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Board } from '../../shared/Board/index.ts';
import { getPlayerName } from '../../shared/profile.ts';
import { Button, GameLayout, Icons, Panel } from '../../shared/ui.tsx';
import { CheckPanel } from './CheckPanel.tsx';
import {
  allTicked, clockNow, currentFen, formatClock, lastMoveSquares, levelLabel, LOW_CLOCK_MS, mindText, moveRows, previewMove,
  resultText, turnOf, type BotGame, type Side,
} from './playLogic.ts';
import type { BotGameApi } from './useBotGame.ts';

/** Keys for the blunder check. Checkboxes keep their own keys; typing in text fields is left alone. */
function useCheckKeys(enabled: boolean, keys: { toggle: (i: 0 | 1 | 2) => void; play: () => boolean; takeBack: () => void }) {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox'))) return;
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        ref.current.toggle((Number(e.key) - 1) as 0 | 1 | 2);
      } else if (e.key === 'Enter') {
        // A focused button (Take back, Play) does its own thing on Enter.
        if (t && t.tagName === 'BUTTON') return;
        if (ref.current.play()) {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        ref.current.takeBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

function PlayerBar({ name, level, clock, running, low }: { name: string; level?: string; clock: number; running: boolean; low: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl px-3 py-1.5 ${running ? 'bg-ink-800' : 'bg-ink-850'}`}>
      <div className="min-w-0 truncate text-sm font-bold">
        {name}
        {level && <span className="ml-1.5 font-normal text-ink-400">{level}</span>}
      </div>
      <div
        className={`shrink-0 font-mono text-xl font-black tabular-nums ${low ? 'text-bad-400' : running ? 'text-ink-100' : 'text-ink-400'}`}
        role="timer"
        aria-label={`${name} clock`}
      >
        {formatClock(clock)}
      </div>
    </div>
  );
}

function usePlayerName(): string {
  const [name, setName] = useState('You');
  useEffect(() => {
    let cancelled = false;
    void getPlayerName()
      .then((n) => {
        if (!cancelled && n.trim()) setName(n.trim());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return name;
}

function MoveList({ game }: { game: BotGame }) {
  const rows = useMemo(() => moveRows(game.moves), [game.moves]);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [rows.length, game.moves.length]);
  if (!rows.length) return <p className="text-sm text-ink-500">No moves yet.</p>;
  return (
    <ol className="max-h-56 overflow-y-auto font-mono text-sm tabular-nums" aria-label="Moves">
      {rows.map((r) => (
        <li key={r.n} className="grid grid-cols-[2.5rem_1fr_1fr] gap-1 py-0.5">
          <span className="text-ink-500">{r.n}.</span>
          <span>{r.w}</span>
          <span>{r.b ?? ''}</span>
        </li>
      ))}
      <li ref={end} aria-hidden className="h-0" />
    </ol>
  );
}

/** One bot game: board, clocks, the blunder check and, at the end, the result. */
export function GameScreen({ api }: { api: BotGameApi }) {
  const game = api.game as BotGame;
  const { held } = api;
  const navigate = useNavigate();
  const playerName = usePlayerName();
  const [flipped, setFlipped] = useState(false);

  const over = game.status === 'over';
  const turn = turnOf(game);
  const yourTurn = game.status === 'playing' && turn === game.you;
  const engineReady = api.engineState === 'ready';
  const interactive = yourTurn && engineReady && !held;

  const preview = held ? previewMove(game, held.uci) : null;
  const fen = preview ? preview.fen : currentFen(game);
  const last: [string, string] | null = held ? [held.uci.slice(0, 2), held.uci.slice(2, 4)] : lastMoveSquares(game);
  const orientation = (game.you === 'w') !== flipped ? 'white' : 'black';
  const bottom: Side = orientation === 'white' ? 'w' : 'b';
  const top: Side = bottom === 'w' ? 'b' : 'w';

  const barFor = (s: Side) => {
    const clock = clockNow(game, s, api.now);
    return (
      <PlayerBar
        name={s === game.you ? playerName : 'Training bot'}
        level={s === game.you ? undefined : levelLabel(game.elo)}
        clock={clock}
        running={game.status === 'playing' && turn === s}
        low={s === game.you && !over && clock < LOW_CLOCK_MS}
      />
    );
  };

  useCheckKeys(!!held, {
    toggle: (i) => api.toggle((['checks', 'captures', 'threats'] as const)[i]),
    play: () => {
      if (!held || !allTicked(held.ticks)) return false;
      api.confirm();
      return true;
    },
    takeBack: api.takeBack,
  });

  const mind = mindText(game.checks);

  let status: ReactNode = null;
  if (api.botError || api.engineState === 'failed') {
    status = (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bad-500/50 bg-bad-500/10 px-3 py-2 text-sm">
        <span className="font-semibold text-bad-400">{api.botError ?? 'The engine did not start.'}</span>
        <Button size="sm" variant="secondary" onClick={api.retryEngine}>
          Try again
        </Button>
      </div>
    );
  } else if (!over && !engineReady) {
    status = (
      <p role="status" className="rounded-xl bg-ink-800 px-3 py-2 text-sm text-ink-300">
        Loading the engine. The clocks start when it is ready.
      </p>
    );
  }

  let actions: ReactNode;
  if (over) {
    actions = (
      <div role="status" className="animate-rise rounded-2xl border border-ink-700/60 bg-ink-850 p-3 shadow-xl shadow-black/20">
        <h2 className="text-lg font-extrabold leading-tight">{resultText(game)}</h2>
        {mind && <p className="mt-1 text-sm text-ink-300">{mind}</p>}
        {api.saveState === 'saving' && <p className="mt-1 text-sm text-ink-400">Saving the game</p>}
        {api.saveState === 'failed' && (
          <p className="mt-1 text-sm text-bad-400">
            The game could not be saved.{' '}
            <button type="button" onClick={api.retrySave} className="min-h-11 font-bold underline lg:min-h-0">
              Try again
            </button>
          </p>
        )}
        {api.saveState === 'done' && !api.storedKey && <p className="mt-1 text-sm text-ink-400">This game was too short to review.</p>}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button variant="primary" disabled={!api.storedKey} onClick={() => api.storedKey && navigate(`/analysis/${api.storedKey}`)}>
            Review it
          </Button>
          <Button variant="secondary" onClick={api.leave}>
            New game
          </Button>
        </div>
      </div>
    );
  } else if (held) {
    actions = <CheckPanel san={held.san} ticks={held.ticks} onToggle={api.toggle} onPlay={api.confirm} onTakeBack={api.takeBack} />;
  } else {
    actions = (
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="ghost" onClick={() => setFlipped((f) => !f)} aria-label="Flip the board">
          {Icons.flip('h-4 w-4')}
          Flip
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (window.confirm('Resign this game?')) api.resignNow();
          }}
        >
          Resign
        </Button>
      </div>
    );
  }

  const turnText = over
    ? 'Game over'
    : !engineReady
      ? 'Waiting for the engine'
      : held
        ? 'Check your move'
        : yourTurn
          ? 'Your move'
          : game.status === 'playing'
            ? 'The bot is thinking'
            : 'Paused';

  // While the blunder check shows, the panel needs room on a phone: the board, bars and panel get a smaller cap.
  const fit = held ? 'max-lg:mx-auto max-lg:max-w-[max(11rem,calc(100dvh-25rem))]' : '';

  return (
    <div className="mx-auto max-w-6xl">
      <GameLayout
        top={<div className={`mb-1.5 ${fit}`}>{barFor(top)}</div>}
        board={
          <div className={fit}>
            <Board
              fen={fen}
              orientation={orientation}
              interactive={interactive}
              movableColor={game.you}
              lastMove={last}
              onMove={api.makeMove}
              annotationKey={game.id}
              positionKey={game.id}
            />
          </div>
        }
        dock={
          <div className="mt-1.5 space-y-1.5">
            <div className={fit}>{barFor(bottom)}</div>
            {status}
            {actions}
          </div>
        }
        side={
          <Panel className="space-y-3">
            <div>
              <h1 className="text-lg font-extrabold leading-tight">Training game</h1>
              <p className="text-sm text-ink-400">
                Level {levelLabel(game.elo)}, {Math.round(game.base / 60000)} + {Math.round(game.inc / 1000)}
              </p>
            </div>
            <p role="status" aria-live="polite" className="text-sm font-semibold text-ink-200">
              {turnText}
            </p>
            <MoveList game={game} />
            <p className="text-xs text-ink-500">Leave the page and the game is paused. Come back to continue it.</p>
          </Panel>
        }
      />
    </div>
  );
}
