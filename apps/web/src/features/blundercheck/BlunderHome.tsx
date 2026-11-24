import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sfx } from '../../shared/fx/index.ts';
import { dayKeyOf } from '../../shared/localDate.ts';
import { Button, Icons, PageHeader, Panel, Segmented, Stat } from '../../shared/ui.tsx';
import { dayScore, gamesUsable, lastDays, MIN_GAME_ITEMS, parseChoice, type CheckMode, type CheckSource } from './blunderLogic.ts';
import { loadGameItems } from './blunderSource.ts';
import { useBlunderTotals } from './blunderStore.ts';

const CHOICE_KEY = 'kf:blundercheck:choice';

const MODES = [
  { id: 'quick', label: 'Quick' },
  { id: 'full', label: 'Full check' },
] as const;

const MODE_TEXT: Record<CheckMode, string> = {
  quick: 'See the move, then say safe or blunder. If you say blunder, you find the enemy reply on the board.',
  full: 'First play every enemy check and capture on the board. Then say safe or blunder.',
};

const SOURCES = [
  { id: 'puzzles', label: 'Puzzle set' },
  { id: 'games', label: 'Your games' },
] as const;

function readChoice() {
  try {
    return parseChoice(localStorage.getItem(CHOICE_KEY));
  } catch {
    return parseChoice(null);
  }
}

interface GamesInfo {
  usable: boolean;
  count: number;
}

const SOURCE_BTN =
  'rounded-lg px-3.5 py-1.5 text-sm font-bold transition-colors max-lg:min-h-11 max-lg:py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400';

/** /train/blunder-check: choose where the positions come from and how thorough the check is. */
export function BlunderHome() {
  const navigate = useNavigate();
  const totals = useBlunderTotals();
  const [choice, setChoice] = useState(readChoice);
  const [games, setGames] = useState<GamesInfo | null>(null);

  useEffect(() => {
    let alive = true;
    loadGameItems()
      .then((items) => {
        if (alive) setGames({ usable: gamesUsable(items), count: items.length });
      })
      .catch(() => {
        if (alive) setGames({ usable: false, count: 0 });
      });
    return () => {
      alive = false;
    };
  }, []);

  const gamesOff = games !== null && !games.usable;
  const source: CheckSource = gamesOff ? 'puzzles' : choice.source;
  const today = dayKeyOf(Date.now());
  const todayScore = totals ? dayScore(totals, today) : null;
  const week = totals ? lastDays(totals, today, 7) : [];
  const weekMax = Math.max(1, ...week.map((d) => d.total));

  const remember = (next: { source: CheckSource; mode: CheckMode }) => {
    setChoice(next);
    try {
      localStorage.setItem(CHOICE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  const start = () => {
    remember({ source, mode: choice.mode });
    navigate(`/train/blunder-check/play?s=${source}&m=${choice.mode}`);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Blunder check"
        subtitle="Is the planned move safe? Look before you play"
        icon={Icons.lock('h-6 w-6')}
        right={
          <Link to="/train" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition hover:text-ink-100">
            ← Train
          </Link>
        }
      />

      <Panel className="mb-4 animate-rise">
        <p className="text-sm text-ink-300">
          A check attacks the king, a capture takes a piece, and a threat is a move that sets up a check or a capture on the next turn.
          Before you play a move, look at all of the enemy's checks, captures and threats in the position it leaves behind.
        </p>
      </Panel>

      <Panel className="mb-4 animate-rise space-y-4">
        <div>
          <div className="mb-2 text-sm font-semibold text-ink-300">Positions from</div>
          <div role="radiogroup" aria-label="Positions from" className="inline-flex rounded-xl bg-ink-900 p-1">
            {SOURCES.map((o) => {
              const disabled = o.id === 'games' && gamesOff;
              const on = o.id === source;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => {
                    if (on) return;
                    sfx.click();
                    remember({ source: o.id, mode: choice.mode });
                  }}
                  className={`${SOURCE_BTN} disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-ink-700 text-ember-400 shadow' : 'text-ink-400 hover:text-ink-100'}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {gamesOff ? (
            <p className="mt-2 text-sm text-ink-400">
              Your games need at least {MIN_GAME_ITEMS} reviewed positions, with both good moves and mistakes. You have {games?.count ?? 0}.{' '}
              <Link to="/analysis" className="inline-flex min-h-11 items-center font-semibold text-ember-400 hover:text-ember-300">
                Review a game
              </Link>
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-400">
              {source === 'games'
                ? 'Moves from your reviewed games: the mistakes you made and the good moves you found.'
                : 'Puzzle positions checked by the engine. The first position can take a few seconds.'}
            </p>
          )}
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-ink-300">Mode</div>
          <Segmented label="Mode" options={MODES} value={choice.mode} onChange={(mode) => remember({ source, mode })} />
          <p className="mt-2 text-sm text-ink-400">{MODE_TEXT[choice.mode]}</p>
        </div>

        <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={start} disabled={games === null && choice.source === 'games'}>
          Start {Icons.next('h-5 w-5')}
        </Button>
      </Panel>

      <Panel className="animate-rise">
        <h2 className="mb-3 text-lg font-extrabold">Your totals</h2>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Stat label="Judged today" value={todayScore?.total ?? 0} />
          <Stat label="Right today" value={todayScore?.total ? `${Math.round((todayScore.correct / todayScore.total) * 100)}%` : '–'} accent="text-ember-400" />
        </div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Last 7 days</h3>
        <ul className="space-y-1.5">
          {week.map((d) => (
            <li key={d.date} className="flex items-center gap-3 text-sm">
              <span className="w-10 shrink-0 text-ink-300">{new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-ink-800" aria-hidden>
                <div className="h-full rounded-full bg-ember-500" style={{ width: `${(d.total / weekMax) * 100}%` }} />
              </div>
              <span className="w-32 shrink-0 text-right text-ink-400 tabular max-[400px]:w-24 max-[400px]:text-xs">
                {d.total ? `${d.total} judged, ${Math.round((d.correct / d.total) * 100)}% right` : 'none'}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
