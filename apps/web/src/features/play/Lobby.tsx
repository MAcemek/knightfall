import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../shared/db.ts';
import { deleteGame } from '../../shared/analysis/index.ts';
import { userSide } from '../../shared/analysis/side.ts';
import { Button, EmptyState, Icons, PageHeader, Panel, Pill, Segmented } from '../../shared/ui.tsx';
import {
  BOT_MAX, BOT_MIN, defaultElo, formatClock, latestRapidRating, levelLabel, pastGameRow, resolveColor, snapElo, TIME_CONTROLS,
  type ColorChoice,
} from './playLogic.ts';
import type { BotGameApi } from './useBotGame.ts';

const COLORS = [
  { id: 'w', label: 'White' },
  { id: 'random', label: 'Random' },
  { id: 'b', label: 'Black' },
] as const;

const TC_OPTIONS = TIME_CONTROLS.map((t) => ({ id: t.id, label: t.label }));

const OUTCOME_TEXT = { win: 'Win', loss: 'Loss', draw: 'Draw' } as const;
const OUTCOME_STYLE = { win: 'text-good-400', loss: 'text-bad-400', draw: 'text-ink-300' } as const;

function PastGames() {
  const rows = useLiveQuery(() => db.games.where('source').equals('bot').toArray(), []);
  const list = useMemo(
    () =>
      (rows ?? [])
        .slice()
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, 10)
        .map((g) => pastGameRow(g, userSide(g))),
    [rows],
  );
  if (!rows) return null;
  return (
    <section aria-labelledby="past-games" className="mt-6">
      <h2 id="past-games" className="mb-2 text-lg font-extrabold">
        Your bot games
      </h2>
      {!list.length ? (
        <EmptyState icon={Icons.swords('h-6 w-6')} title="No games yet">
          A finished game shows up here so you can review it.
        </EmptyState>
      ) : (
        <ul className="grid gap-2">
          {list.map((r) => {
            const when = new Date(r.playedAt).toLocaleDateString();
            return (
              <li key={r.key} className="flex items-stretch gap-1 rounded-2xl border border-ink-700/60 bg-ink-850 shadow-xl shadow-black/20">
                <Link
                  to={`/analysis/${r.key}`}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-ink-800/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
                >
                  <span className={`w-12 shrink-0 text-sm font-extrabold ${r.outcome ? OUTCOME_STYLE[r.outcome] : 'text-ink-400'}`}>
                    {r.outcome ? OUTCOME_TEXT[r.outcome] : 'Game'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-300">{r.level ? levelLabel(r.level) : 'Training bot'}</span>
                  <span className="shrink-0 text-xs text-ink-400">{when}</span>
                </Link>
                <button
                  type="button"
                  aria-label={`Delete the game from ${when}`}
                  onClick={() => {
                    if (window.confirm('Delete this game and its review? This cannot be undone.')) void deleteGame(r.key).catch(() => undefined);
                  }}
                  className="inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-ink-400 transition-colors hover:bg-ink-800 hover:text-bad-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
                >
                  {Icons.x('h-4 w-4')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Pick a level, a time control and a colour, or continue the saved game. */
export function Lobby({ api }: { api: BotGameApi }) {
  const ratings = useLiveQuery(() => db.ratingLog.toArray(), []);
  const suggested = useMemo(() => defaultElo(latestRapidRating(ratings)), [ratings]);
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [tcId, setTcId] = useState(TIME_CONTROLS[0].id);
  const [color, setColor] = useState<ColorChoice>('random');
  const elo = picked ?? suggested;
  const tc = TIME_CONTROLS.find((t) => t.id === tcId) ?? TIME_CONTROLS[0];
  const saved = api.saved;

  const setLevel = (v: number) => {
    setPicked(snapElo(v));
    setTyped(null);
  };

  const start = () => {
    if (saved && !window.confirm('Starting a new game replaces the game you have saved. Start anyway?')) return;
    api.start({ base: tc.base, inc: tc.inc, you: resolveColor(color, Math.random()), elo });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Play the bot"
        subtitle="Slow games where you check every move before it is played"
        icon={Icons.swords('h-6 w-6')}
        right={
          <Link to="/train" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition hover:text-ink-100">
            ← Train
          </Link>
        }
      />

      {saved && (
        <Panel className="mb-4 animate-rise">
          <h2 className="text-lg font-extrabold">Continue your game</h2>
          <p className="mt-0.5 text-sm text-ink-400">
            Level {levelLabel(saved.elo)}, {Math.round(saved.base / 60000)} + {Math.round(saved.inc / 1000)}, you are {saved.you === 'w' ? 'White' : 'Black'}.{' '}
            {saved.moves.length} {saved.moves.length === 1 ? 'move' : 'moves'} played. Your clock: {formatClock(saved.clocks[saved.you])}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={api.continueSaved}>
              Continue
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm('Discard the saved game? It will not be stored.')) api.discardSaved();
              }}
            >
              Discard
            </Button>
          </div>
        </Panel>
      )}

      <Panel className="animate-rise space-y-4">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor="bot-level" className="text-sm font-semibold text-ink-300">
              Level
            </label>
            <Pill className="text-ember-400">{levelLabel(elo)}</Pill>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <input
              id="bot-level"
              type="range"
              min={BOT_MIN}
              max={BOT_MAX}
              step={10}
              value={elo}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="h-11 min-w-0 flex-1 accent-[var(--color-ember-500)]"
            />
            <input
              type="number"
              inputMode="numeric"
              aria-label="Level as a number"
              min={BOT_MIN}
              max={BOT_MAX}
              step={10}
              value={typed ?? String(elo)}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => {
                if (typed !== null && typed.trim() !== '') setLevel(Number(typed));
                else setTyped(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed !== null && typed.trim() !== '') setLevel(Number(typed));
              }}
              className="h-11 w-24 rounded-xl border border-ink-700 bg-ink-900 px-3 text-center font-mono font-bold tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
            />
          </div>
          <p className="mt-1 text-xs text-ink-500">
            From {BOT_MIN} to {BOT_MAX}. Engine levels do not match chess.com ratings exactly, so treat the number as a rough guide.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink-300">Time</span>
          <Segmented label="Time control in minutes plus seconds per move" options={TC_OPTIONS} value={tcId} onChange={setTcId} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink-300">You play</span>
          <Segmented label="Your colour" options={COLORS} value={color} onChange={setColor} />
        </div>

        <Button variant="primary" size="lg" className="w-full" onClick={start}>
          Start
        </Button>

        <p className="text-sm text-ink-400">
          Before each move is played you tick three boxes: the checks they have, the pieces they can take and what they threaten next. No
          evaluation is shown during the game. When it ends you can review it with the engine.
        </p>
      </Panel>

      <PastGames />
    </div>
  );
}
