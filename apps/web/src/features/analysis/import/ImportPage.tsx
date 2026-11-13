import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteGame, importGames, importUserGames, setAnalysisPrefs, useAnalysedKeys, useAnalysisPrefs, useRecentAnalyses, useUserGames } from '../../../shared/analysis/index.ts';
import type { StoredGame } from '../../../shared/db.ts';
import { deepEngineAvailable } from '../../../shared/engine/engines.ts';
import { ImportError } from '../../../shared/importers/mappers.ts';
import { Button, EmptyState, Icons, Kbd, PageHeader, Panel, Pill, Segmented } from '../../../shared/ui.tsx';
import { INPUT_HINT, inputKind, moveCount, opponentOf, outcomeFor, playedLabel, playerLabel, speedLabel, type Outcome } from './importLogic.ts';

type Site = 'lichess' | 'chesscom';

const SITE_NAME: Record<Site, string> = { lichess: 'Lichess', chesscom: 'chess.com' };
const TAB_OPTIONS = [
  { id: 'lichess', label: 'Lichess games' },
  { id: 'chesscom', label: 'chess.com games' },
] as const;

interface Failure {
  message: string;
  fallback?: 'username' | 'pgn';
}

function failureOf(e: unknown, site?: Site): Failure {
  if (e instanceof ImportError) {
    if (e.code === 'rate_limited' && (site === 'lichess' || !site)) return { message: site === 'lichess' ? 'Lichess is busy, try again in a minute.' : e.message, fallback: e.fallback };
    return { message: e.message, fallback: e.fallback };
  }
  return { message: 'Something went wrong. Please try again.' };
}

function sideOf(game: StoredGame, user: string): 'w' | 'b' | null {
  const u = user.trim().toLowerCase();
  if (!u) return null;
  if (game.white.name.toLowerCase() === u) return 'w';
  if (game.black.name.toLowerCase() === u) return 'b';
  return null;
}

const OUTCOME_STYLE: Record<Outcome, { label: string; cls: string }> = {
  win: { label: 'Win', cls: 'bg-good-500/20 text-good-400' },
  loss: { label: 'Loss', cls: 'bg-bad-500/20 text-bad-400' },
  draw: { label: 'Draw', cls: 'bg-sky-500/20 text-sky-400' },
  unknown: { label: '—', cls: 'bg-ink-700 text-ink-300' },
};

function ResultBadge({ outcome }: { outcome: Outcome }) {
  const s = OUTCOME_STYLE[outcome];
  return <span className={`inline-flex h-7 w-14 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold uppercase tracking-wide ${s.cls}`}>{s.label}</span>;
}

function Spinner() {
  return <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-600 border-t-ember-400" />;
}

function ErrorNote({ failure, actions }: { failure: Failure; actions?: React.ReactNode }) {
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-400">
      <span className="min-w-0 break-words">{failure.message}</span>
      {actions}
    </div>
  );
}

function GameRow({ game, user, reviewed, onOpen, index }: { game: StoredGame; user: string; reviewed: boolean; onOpen: () => void; index: number }) {
  const side = sideOf(game, user);
  const outcome = outcomeFor(game, side);
  const speed = speedLabel(game);
  const opp = side ? playerLabel(opponentOf(game, side)) : `${game.white.name} vs ${game.black.name}`;
  return (
    <li className="animate-rise" style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-xl bg-ink-800/70 px-3 py-2.5 text-left transition-colors hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
      >
        <ResultBadge outcome={outcome} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold text-ink-100">{opp}</span>
          <span className="block truncate text-xs text-ink-400">
            {[speed, game.opening?.name, `${moveCount(game.plies)} moves`, playedLabel(game.playedAt, Date.now())].filter(Boolean).join(' · ')}
          </span>
        </span>
        {reviewed && <Pill className="shrink-0 bg-good-500/20 text-good-400">Reviewed</Pill>}
      </button>
    </li>
  );
}

function resultText(r: string): string {
  return r === '1/2-1/2' ? '½–½' : r === '*' ? '*' : r.replace('-', '–');
}

/** /analysis: import a game (link, id or PGN), pick one from a user's recent games, or reopen a past review. */
export function ImportPage() {
  const navigate = useNavigate();
  const prefs = useAnalysisPrefs();
  const analysed = useAnalysedKeys();
  const recent = useRecentAnalyses(8);

  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [picks, setPicks] = useState<StoredGame[]>([]);

  const [tab, setTab] = useState<Site>('lichess');
  const [names, setNames] = useState<Record<Site, string>>({ lichess: '', chesscom: '' });
  const [loadedFor, setLoadedFor] = useState<Record<Site, string>>({ lichess: '', chesscom: '' });
  const seeded = useRef(false);
  const [loading, setLoading] = useState(false);
  const [streamed, setStreamed] = useState<StoredGame[]>([]);
  const [userFailure, setUserFailure] = useState<Failure | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [deepOk, setDeepOk] = useState(false);

  useEffect(() => {
    let live = true;
    deepEngineAvailable().then((ok) => live && setDeepOk(ok), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!prefs || seeded.current) return;
    seeded.current = true;
    setNames({ lichess: prefs.lichessUser, chesscom: prefs.chesscomUser });
    setLoadedFor({ lichess: prefs.lichessUser, chesscom: prefs.chesscomUser });
  }, [prefs]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const kind = inputKind(text);
  const engine = prefs?.engine ?? 'lite';

  async function submit() {
    if (busy || kind === 'empty' || kind === 'invalid') return;
    setBusy(true);
    setFailure(null);
    setWarnings([]);
    setPicks([]);
    try {
      const { games, warnings: w } = await importGames(text);
      setWarnings(w);
      if (games.length === 1) navigate(`/analysis/${games[0]!.key}`);
      else if (games.length > 1) setPicks(games);
    } catch (e) {
      setFailure(failureOf(e, kind === 'lichess' ? 'lichess' : undefined));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.ctrlKey || e.metaKey || kind !== 'pgn') {
      e.preventDefault();
      void submit();
    }
  }

  function useUsernameFallback() {
    setFailure(null);
    setTab('chesscom');
  }

  async function loadUser() {
    const site = tab;
    const name = names[site].trim();
    if (!name || loading) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setUserFailure(null);
    setStreamed([]);
    setLoadedFor((p) => ({ ...p, [site]: name }));
    try {
      await setAnalysisPrefs(site === 'lichess' ? { lichessUser: name } : { chesscomUser: name });
      await importUserGames(site, name, { signal: ctl.signal, onGame: (g) => setStreamed((p) => [...p, { ...g, importedFor: name.toLowerCase() }]) });
    } catch (e) {
      if (!ctl.signal.aborted) setUserFailure(failureOf(e, site));
    } finally {
      setLoading(false);
      setStreamed([]);
      if (abortRef.current === ctl) abortRef.current = null;
    }
  }

  const stored = useUserGames(tab, loadedFor[tab]);
  const listed = loading && streamed.length ? streamed : (stored ?? []);
  const shownUser = loadedFor[tab];

  function chooseEngine(id: 'lite' | 'deep') {
    if (id === engine || (id === 'deep' && !deepOk)) return;
    void setAnalysisPrefs({ engine: id });
  }

  async function remove(g: StoredGame) {
    if (window.confirm(`Delete the review of ${g.white.name} vs ${g.black.name}? This removes the game and its analysis from this browser.`)) await deleteGame(g.key);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Game Review" subtitle="Analyse any game with Stockfish" icon={Icons.search('h-6 w-6')} />

      <Panel className="mb-4 animate-rise">
        <label htmlFor="kf-paste" className="mb-2 block text-lg font-extrabold">
          Analyse a game
        </label>
        <textarea
          id="kf-paste"
          ref={boxRef}
          value={text}
          rows={kind === 'pgn' ? 10 : 2}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://lichess.org/abcd1234  ·  chess.com game link  ·  PGN"
          onChange={(e) => {
            setText(e.target.value);
            setFailure(null);
          }}
          onKeyDown={onKeyDown}
          className="w-full resize-y rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 font-mono text-sm text-ink-100 placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className={`min-w-0 text-sm ${kind === 'invalid' ? 'text-bad-400' : 'text-ink-400'}`}>
            {INPUT_HINT[kind]}
            {kind !== 'empty' && kind !== 'invalid' && (
              <span className="ml-2 hidden text-ink-500 sm:inline">
                <Kbd>{kind === 'pgn' ? 'Ctrl' : 'Enter'}</Kbd>
                {kind === 'pgn' && (
                  <>
                    {' + '}
                    <Kbd>Enter</Kbd>
                  </>
                )}
              </span>
            )}
          </p>
          <Button variant="primary" disabled={busy || kind === 'empty' || kind === 'invalid'} onClick={() => void submit()}>
            {busy ? <Spinner /> : Icons.search('h-4 w-4')} {busy ? 'Fetching…' : 'Analyse'}
          </Button>
        </div>

        {failure && (
          <ErrorNote
            failure={failure}
            actions={
              failure.fallback === 'username' ? (
                <Button size="sm" onClick={useUsernameFallback}>
                  Find it in {prefs?.chesscomUser ? `${prefs.chesscomUser}'s ` : 'your '}recent games
                </Button>
              ) : failure.fallback === 'pgn' ? (
                <Button size="sm" onClick={() => boxRef.current?.focus()}>
                  Paste the PGN instead
                </Button>
              ) : undefined
            }
          />
        )}
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-xl border border-ember-500/40 bg-ember-500/10 px-3 py-2 text-sm text-ember-300">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        {picks.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">{picks.length} games found. Pick one</h3>
            <ul className="space-y-2">
              {picks.map((g, i) => (
                <li key={g.key} className="animate-rise" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                  <button
                    type="button"
                    onClick={() => navigate(`/analysis/${g.key}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl bg-ink-800/70 px-3 py-2.5 text-left hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
                  >
                    <span className="min-w-0 truncate font-bold">
                      {i + 1}. {playerLabel(g.white)} vs {playerLabel(g.black)}
                    </span>
                    <span className="shrink-0 font-mono text-sm text-ink-300">{resultText(g.result)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <div className="mb-4 animate-rise" style={{ animationDelay: '60ms' }}>
        <Panel>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold">Your recent games</h2>
            <Segmented label="Game site" options={TAB_OPTIONS} value={tab} onChange={(t) => { setTab(t); setUserFailure(null); }} />
          </div>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void loadUser();
            }}
          >
            <input
              aria-label={`${SITE_NAME[tab]} username`}
              value={names[tab]}
              onChange={(e) => setNames((p) => ({ ...p, [tab]: e.target.value }))}
              placeholder={`${SITE_NAME[tab]} username`}
              maxLength={30}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-900 px-3 text-ink-100 placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
            />
            {loading ? (
              <Button type="button" variant="ghost" onClick={() => abortRef.current?.abort()}>
                {Icons.x('h-4 w-4')} Cancel
              </Button>
            ) : (
              <Button type="submit" variant="secondary" disabled={!names[tab].trim()}>
                Load
              </Button>
            )}
          </form>
          {loading && (
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-300" role="status">
              <Spinner /> Loading games{streamed.length ? ` (${streamed.length})` : ''}…
            </p>
          )}
          {userFailure && <ErrorNote failure={userFailure} />}

          <div className="mt-4">
            {listed.length > 0 ? (
              <ul className="space-y-2">
                {listed.map((g, i) => (
                  <GameRow key={g.key} game={g} user={shownUser} reviewed={analysed?.has(g.key) ?? false} index={i} onOpen={() => navigate(`/analysis/${g.key}`)} />
                ))}
              </ul>
            ) : (
              !loading && (
                <EmptyState icon={Icons.layers('h-6 w-6')} title="No games loaded yet">
                  Enter a {SITE_NAME[tab]} username and press Load to list their newest games.
                </EmptyState>
              )
            )}
          </div>
        </Panel>
      </div>

      <div className="mb-4 animate-rise" style={{ animationDelay: '120ms' }}>
        <Panel>
          <h2 className="mb-3 text-lg font-extrabold">Recent reviews</h2>
          {recent && recent.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {recent.map(({ game, analysis }, i) => {
                const acc = analysis.report.accuracy;
                const fmt = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);
                return (
                  <li key={game.key} className="animate-rise relative min-w-0" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                    <button
                      type="button"
                      onClick={() => navigate(`/analysis/${game.key}`)}
                      className="block w-full rounded-xl bg-ink-800/70 p-3 pr-11 text-left transition-colors hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
                    >
                      <span className="block truncate font-bold text-ink-100">
                        {game.white.name} vs {game.black.name}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-400">
                        <span className="font-mono text-ink-200">{resultText(game.result)}</span>
                        <span>{playedLabel(game.playedAt, Date.now())}</span>
                      </span>
                      {(acc.white !== null || acc.black !== null) && (
                        <span className="mt-1 block font-mono text-xs text-violet-400">
                          Accuracy {fmt(acc.white)} / {fmt(acc.black)}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete review of ${game.white.name} vs ${game.black.name}`}
                      onClick={() => void remove(game)}
                      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-bad-500/20 hover:text-bad-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
                    >
                      {Icons.x('h-4 w-4')}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-400">{recent ? 'Finished reviews show up here.' : ''}</p>
          )}
        </Panel>
      </div>

      <div className="animate-rise space-y-3 pb-4" style={{ animationDelay: '180ms' }}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-ink-300">Engine:</span>
          <div role="radiogroup" aria-label="Engine" className="inline-flex rounded-xl bg-ink-900 p-1">
            {(['lite', 'deep'] as const).map((id) => {
              const disabled = id === 'deep' && !deepOk;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={engine === id}
                  disabled={disabled}
                  title={disabled ? 'Needs npm run engine:deep' : id === 'deep' ? 'Stockfish 19, depth 20' : 'Stockfish 19 Lite, depth 16'}
                  onClick={() => chooseEngine(id)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 disabled:cursor-not-allowed disabled:opacity-40 ${engine === id ? 'bg-ink-700 text-ember-400 shadow' : 'text-ink-400 hover:text-ink-100'}`}
                >
                  {id === 'lite' ? 'Lite' : 'Deep'}
                </button>
              );
            })}
          </div>
          {!deepOk && <span className="text-xs text-ink-500">Deep needs npm run engine:deep</span>}
        </div>
        <p className="text-xs text-ink-500">Games are fetched from Lichess / chess.com and stored only in your browser.</p>
      </div>
    </div>
  );
}
