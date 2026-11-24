import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Board, type BoardArrow, type BoardMark } from '../../shared/Board/index.ts';
import { sfx } from '../../shared/fx/index.ts';
import { BOARD_SHORTCUTS, ShortcutHelp, type ShortcutGroup } from '../../shared/ShortcutHelp.tsx';
import { Button, GameLayout, Icons, PageHeader, Panel, Pill, Stat } from '../../shared/ui.tsx';
import { reviewHref } from '../analysis/insights/insightsLogic.ts';
import { useHotkeysWithHelp } from '../puzzles/useHotkeys.ts';
import {
  addToTally, decide, EMPTY_TALLY, enemyForcing, enterMove, fenAfterMove, judgeRefutation, listedSummary, sanOf, tallyPercent, verdictText,
  type CheckItem, type CheckMode, type CheckSource, type Outcome, type Said, type Tally,
} from './blunderLogic.ts';
import { createFeed, isAbortError, type Feed } from './blunderSource.ts';
import { recordOutcome } from './blunderStore.ts';

type Phase = 'gather' | 'decide' | 'refute' | 'done';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Blunder check',
    items: [
      { keys: ['S'], label: 'Say the move is safe' },
      { keys: ['B'], label: 'Say the move is a blunder' },
      { keys: ['D'], label: 'Done listing checks and captures (Full check)' },
      { keys: ['Enter', 'Space'], label: 'Next position' },
      { keys: ['F'], label: 'Flip the board' },
      { keys: ['?'], label: 'Show this help' },
    ],
  },
  BOARD_SHORTCUTS,
];

const sq = (uci: string) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4) });

function KeyHint({ children }: { children: string }) {
  return <kbd className="hidden rounded border border-current/30 px-1 font-mono text-[10px] leading-4 opacity-60 fine:inline-block">{children}</kbd>;
}

function errorText(e: unknown): { text: string; games: boolean } {
  if (e instanceof Error && e.message === 'Not enough reviewed positions yet.') {
    return { text: 'Your games do not have enough reviewed positions yet. Review a few games first.', games: true };
  }
  return { text: 'The engine could not check a position. Try again.', games: false };
}

/** One Blunder check session: a planned move is shown, the player judges it, and the result is saved once per position. */
export function BlunderPlay({ source, mode }: { source: CheckSource; mode: CheckMode }) {
  const [item, setItem] = useState<CheckItem | null>(null);
  const [serial, setSerial] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ text: string; games: boolean } | null>(null);
  const [phase, setPhase] = useState<Phase>('decide');
  const [entered, setEntered] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [playedReply, setPlayedReply] = useState<string | null>(null);
  const [mark, setMark] = useState<BoardMark | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  const [saveFailed, setSaveFailed] = useState(false);

  const control = useRef<{ feed: Feed; signal: AbortSignal } | null>(null);
  const busy = useRef(false);
  /** The item whose result was saved already: a second click or key press on the same position saves nothing. */
  const saved = useRef<CheckItem | null>(null);
  const markKey = useRef(0);

  const load = useCallback(async () => {
    const c = control.current;
    if (!c || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await c.feed.next();
      if (c.signal.aborted) return;
      saved.current = null;
      setItem(next);
      setSerial((s) => s + 1);
      setEntered([]);
      setNote(null);
      setOutcome(null);
      setPlayedReply(null);
      setMark(null);
      setFlipped(false);
      setPhase(mode === 'full' ? 'gather' : 'decide');
      setLoading(false);
    } catch (e) {
      if (isAbortError(e) || c.signal.aborted) return;
      setError(errorText(e));
      setLoading(false);
    } finally {
      if (control.current === c) busy.current = false;
    }
  }, [mode]);

  // One feed per mount. StrictMode runs this twice: the first run is aborted by its cleanup and ignored.
  useEffect(() => {
    const ac = new AbortController();
    control.current = { feed: createFeed(source, ac.signal), signal: ac.signal };
    busy.current = false;
    void load();
    return () => ac.abort();
  }, [source, load]);

  const forcing = useMemo(() => (item ? enemyForcing(item.fenAfter) : []), [item]);
  const enteredMoves = forcing.filter((m) => entered.includes(m.from + m.to));
  const missed = forcing.filter((m) => !entered.includes(m.from + m.to));
  const opponent = item ? (item.mover === 'w' ? 'b' : 'w') : 'b';

  const finish = (result: Outcome) => {
    if (!item || saved.current === item) return;
    saved.current = item;
    setOutcome(result);
    setPhase('done');
    setTally((t) => addToTally(t, result));
    if (result === 'correct') sfx.correct();
    else sfx.wrong();
    recordOutcome(result).catch(() => setSaveFailed(true));
  };

  const choose = (said: Said) => {
    if (!item || phase !== 'decide' || loading) return;
    const r = decide(item, said);
    if (r === 'ask') setPhase('refute');
    else finish(r);
  };

  const finishListing = () => {
    if (item && phase === 'gather' && !loading) setPhase('decide');
  };

  const giveUp = () => {
    if (phase === 'refute' && !loading) finish('wrong-reason');
  };

  const next = () => {
    if (phase === 'done' && !loading) void load();
  };

  const showMark = (square: string, kind: BoardMark['kind']) => {
    markKey.current += 1;
    setMark({ square, kind, key: markKey.current });
  };

  const onBoardMove = (uci: string) => {
    if (!item || loading) return;
    const { to } = sq(uci);
    if (phase === 'gather') {
      const r = enterMove(item.fenAfter, entered, uci);
      if (r === 'added') {
        setEntered((list) => [...list, uci.slice(0, 4)]);
        setNote(null);
        showMark(to, 'correct');
        sfx.correct();
      } else if (r === 'repeat') {
        setNote('You already listed that move.');
      } else if (r === 'quiet') {
        setNote(`${sanOf(item.fenAfter, uci) ?? 'That move'} is not a check or capture.`);
        showMark(to, 'wrong');
        setShakeKey((k) => k + 1);
        sfx.wrong();
      }
    } else if (phase === 'refute') {
      setPlayedReply(uci);
      finish(judgeRefutation(item, uci));
    }
  };

  const help = useHotkeysWithHelp(
    {
      s: () => (phase === 'decide' && !loading ? choose('safe') : false),
      b: () => (phase === 'decide' && !loading ? choose('blunder') : false),
      d: () => (phase === 'gather' && !loading ? finishListing() : false),
      enter: () => (phase === 'done' && !loading ? next() : false),
      ' ': () => (phase === 'done' && !loading ? next() : false),
      f: () => setFlipped((v) => !v),
    },
    !error,
  );

  /* ---------------------------------- what the board shows ---------------------------------- */

  const planned = item ? sq(item.planned) : null;
  let fen = START_FEN;
  let lastMove: [string, string] | null = null;
  let interactive = false;
  const arrows: BoardArrow[] = [];
  if (item && planned) {
    fen = item.fenAfter;
    lastMove = [planned.from, planned.to];
    if (phase === 'gather' || phase === 'refute') interactive = !loading;
    if (phase === 'decide') {
      if (mode === 'quick') {
        fen = item.fen;
        lastMove = null;
        arrows.push({ from: planned.from, to: planned.to, color: 'blue' });
      } else {
        for (const m of missed.slice(0, 8)) arrows.push({ from: m.from, to: m.to, color: 'yellow' });
      }
    }
    if (phase === 'done') {
      const reply = item.reply ? sq(item.reply) : null;
      if (outcome === 'correct' && item.blunder && playedReply) {
        fen = fenAfterMove(item.fenAfter, playedReply) ?? item.fenAfter;
        const p = sq(playedReply);
        lastMove = [p.from, p.to];
      } else if ((outcome === 'missed' || outcome === 'wrong-reason') && reply) {
        arrows.push({ from: reply.from, to: reply.to, color: 'red' });
      }
    }
  }
  const orientation = (item ? item.mover === 'w' : true) !== flipped ? 'white' : 'black';
  const verdict = item && outcome ? verdictText(outcome, item) : null;

  /* ---------------------------------- text ---------------------------------- */

  const planText = item ? `You plan to play ${item.plannedSan}. Safe or blunder?` : '';
  let prompt = 'Getting a position ready';
  let body: string | null = null;
  if (item && !loading) {
    if (phase === 'gather') {
      prompt = `You plan ${item.plannedSan}. It is on the board.`;
      body = 'Play every check and capture the enemy has in this position. The pieces stay where they are. Press Done when you have them all.';
    } else if (phase === 'decide') {
      prompt = planText;
      body = mode === 'quick' ? 'Look at the enemy checks, captures and threats before you answer.' : null;
    } else if (phase === 'refute') {
      prompt = 'Find the enemy reply that punishes it.';
      body = 'Play it on the board. You have one try.';
    } else if (verdict) {
      prompt = verdict.title;
      body = verdict.text;
    }
  }

  const actions = (
    <div className="grid grid-cols-2 gap-2">
      {phase === 'gather' && (
        <Button variant="primary" className="col-span-2" disabled={loading || !item} onClick={finishListing}>
          Done <KeyHint>D</KeyHint>
        </Button>
      )}
      {phase === 'decide' && (
        <>
          <Button variant="good" disabled={loading || !item} onClick={() => choose('safe')} aria-label="Safe">
            Safe <KeyHint>S</KeyHint>
          </Button>
          <Button variant="danger" disabled={loading || !item} onClick={() => choose('blunder')} aria-label="Blunder">
            Blunder <KeyHint>B</KeyHint>
          </Button>
        </>
      )}
      {phase === 'refute' && (
        <Button className="col-span-2" disabled={loading} onClick={giveUp}>
          I do not see it
        </Button>
      )}
      {phase === 'done' && (
        <Button variant="primary" className="col-span-2" disabled={loading} onClick={next}>
          {loading ? 'Loading' : 'Next'} {Icons.next('h-4 w-4')} <KeyHint>Enter</KeyHint>
        </Button>
      )}
    </div>
  );

  const header = (
    <PageHeader
      compact
      title="Blunder check"
      subtitle={mode === 'full' ? 'Full check' : 'Quick'}
      icon={Icons.lock('h-6 w-6')}
      right={
        <Link to="/train/blunder-check" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition-colors hover:text-ink-100">
          End session
        </Link>
      }
    />
  );

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <Panel className="space-y-3" >
          <p role="alert" className="text-ink-100">{error.text}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void load()}>
              Try again
            </Button>
            {error.games && (
              <Link to="/analysis" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-ember-400 hover:text-ember-300">
                Review a game
              </Link>
            )}
            <Link to="/train/blunder-check" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-ink-400 hover:text-ink-100">
              Back
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  const percent = tallyPercent(tally);

  return (
    <>
      {header}
      <GameLayout
        board={
          <div className="relative">
            <Board
              fen={fen}
              orientation={orientation}
              interactive={interactive}
              movableColor={opponent}
              lastMove={lastMove}
              arrows={arrows}
              mark={mark}
              shakeKey={shakeKey}
              onMove={onBoardMove}
              positionKey={serial}
              annotationKey={`${serial}-${phase}`}
            />
            {loading && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink-950/40 backdrop-blur-[1px]" role="status" aria-label="Getting a position ready">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-ink-600 border-t-ember-400" />
              </div>
            )}
          </div>
        }
        dock={
          <div className="mt-2 space-y-2 lg:hidden">
            <p className="text-sm font-semibold text-ink-100" role="status">
              {phase === 'gather' && item && !loading ? `Listed ${entered.length}. Press Done when you have them all.` : prompt}
            </p>
            {item && !loading && (phase === 'gather' || (phase === 'decide' && mode === 'full')) && (
              <p className="min-h-10 text-sm text-ember-400" role="status">
                {phase === 'gather' ? note : listedSummary(enteredMoves.length, forcing.length, missed)}
              </p>
            )}
            {actions}
          </div>
        }
        side={
          <div className="space-y-3">
            <Panel className="space-y-3">
              {item && (
                <div className="flex flex-wrap gap-1.5">
                  <Pill>{item.mover === 'w' ? 'You play White' : 'You play Black'}</Pill>
                  <Pill>{item.source === 'games' ? 'From your games' : 'From the puzzle set'}</Pill>
                </div>
              )}
              <div role="status" aria-live="polite" className="space-y-1">
                <h2 className={`text-lg font-extrabold leading-snug ${verdict ? (verdict.good ? 'text-good-400' : 'text-bad-400') : ''}`}>{prompt}</h2>
                {body && <p className="text-sm text-ink-300">{body}</p>}
                {phase === 'done' && item && !loading && <p className="text-sm text-ink-300">{item.note}</p>}
              </div>

              {(phase === 'gather' || (phase === 'decide' && mode === 'full')) && item && !loading && (
                <div className="space-y-2">
                  {phase === 'gather' && (
                    <>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">Listed so far ({entered.length})</h3>
                      {enteredMoves.length ? (
                        <ul className="flex flex-wrap gap-1.5">
                          {enteredMoves.map((m) => (
                            <li key={m.from + m.to} className="rounded-lg bg-ink-800 px-2 py-1 font-mono text-sm text-ink-100">
                              {m.san}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-ink-500">Nothing yet.</p>
                      )}
                      <p className="min-h-5 text-sm text-ember-400" role="status">{note}</p>
                    </>
                  )}
                  {phase === 'decide' && (
                    <>
                      <p className="text-sm text-ink-200">
                        You listed {enteredMoves.length} of {forcing.length} checks and captures.
                      </p>
                      {missed.length > 0 ? (
                        <>
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">You missed</h3>
                          <ul className="flex flex-wrap gap-1.5">
                            {missed.map((m) => (
                              <li key={m.from + m.to} className="rounded-lg bg-ink-800 px-2 py-1 font-mono text-sm text-ink-100">
                                {m.san}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="text-sm text-ink-400">{forcing.length ? 'You found them all.' : 'The enemy has no checks or captures here.'}</p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="max-lg:hidden">{actions}</div>

              {phase === 'done' && item?.gameKey !== undefined && item.ply !== undefined && (
                <Link
                  to={reviewHref(item.gameKey, item.ply)}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-ember-400 hover:text-ember-300"
                >
                  Open this move in the review
                </Link>
              )}
              {saveFailed && <p className="text-sm text-bad-400">Could not save today's total.</p>}
            </Panel>

            <Panel className="grid grid-cols-3 gap-2">
              <Stat label="Judged" value={tally.played} />
              <Stat label="Right" value={percent === null ? '–' : `${percent}%`} accent="text-ember-400" />
              <Stat label="Missed" value={tally.missed} />
            </Panel>
            <button
              type="button"
              onClick={help.openHelp}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 max-lg:hidden"
            >
              Keyboard shortcuts <span className="ml-2 rounded border border-ink-600 px-1 font-mono text-xs">?</span>
            </button>
          </div>
        }
      />
      <ShortcutHelp open={help.helpOpen} onClose={help.closeHelp} groups={SHORTCUTS} />
    </>
  );
}
