import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { coachExplainText, parsePgnGame, type MoveClass, type ParsedGame, type PositionEval, type Side } from '@knightfall/core';
import { addMistakesToPractice, practicePuzzles, useAnalysisPrefs, useAnalysisSession } from '../../../shared/analysis/index.ts';
import { Board, type BoardArrow } from '../../../shared/Board/index.ts';
import { ENGINES, getEnginePool } from '../../../shared/engine/index.ts';
import { sfx } from '../../../shared/fx/index.ts';
import { motionScale } from '../../../shared/settings.ts';
import { BOARD_SHORTCUTS, ShortcutHelp, type ShortcutGroup } from '../../../shared/ShortcutHelp.tsx';
import { toast } from '../../../shared/toast.tsx';
import { addToNextSet, useNextPicks } from '../../../shared/woodNext.ts';
import { Button, EmptyState, GameLayout, Icons, Panel } from '../../../shared/ui.tsx';
import { useHotkeysWithHelp } from '../../puzzles/useHotkeys.ts';
import { resolveSide } from '../../../shared/analysis/side.ts';
import type { StoredGame } from '../../../shared/db.ts';
import { ComparisonCard, type EngineState } from '../selfreview/ComparisonCard.tsx';
import { SelfReviewGate } from '../selfreview/SelfReviewGate.tsx';
import { cleanSelfReviewRow, needsSelfReview, selfReviewResult } from '../selfreview/selfReviewLogic.ts';
import { loadGateInputs, useSelfReviewRow } from '../selfreview/selfReviewStore.ts';
import { EvalBar, EvalGraph, ExplorePanel, GRAPH_H, GRAPH_W, MoveBadge, ProgressBar, ReviewHeader, type GraphDot } from './parts.tsx';
import { ActionRow, PhoneCoach, ReviewNav, ReviewView, type ClassFilterView, type ReviewActions, type TipMode } from './ReviewView.tsx';
import { SummaryView } from './SummaryView.tsx';
import { WoodSlot } from './WoodSlot.tsx';
import { woodSlotState } from './woodSlotLogic.ts';
import { lineSteps, moveLabel, provisionalMoves, sideToMoveOf, soundKind, userSide, type LineStep } from './reviewExtras.ts';
import { barFraction, graphGeometry, initialPly, lineToSan, movesOfClass, playUci, positionInClass, stepInClass } from './reviewLogic.ts';
import { judgeRetryMove, retryCanMove, retryFinished, retryHint, retryJudge, retryMessage, retryResume, retryStart, type RetryState } from './retryLogic.ts';
import { MOVE_CLASS_META } from '../../../shared/analysis/index.ts';

const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Review',
    items: [
      { keys: ['←', '↑'], label: 'Previous move' },
      { keys: ['→', '↓'], label: 'Next move' },
      { keys: ['Home'], label: 'Start of the game' },
      { keys: ['End'], label: 'End of the game' },
      { keys: ['F'], label: 'Flip the board' },
      { keys: ['Esc'], label: 'Leave a variation, Explain, Best or Retry' },
      { keys: ['?'], label: 'Show this help' },
    ],
  },
  { title: 'Explore', items: [{ keys: ['Drag'], label: 'Play a different move to start a variation' }] },
  BOARD_SHORTCUTS,
];

/** Classes that offer Retry. */
const RETRY_CLASSES: ReadonlySet<MoveClass> = new Set<MoveClass>(['inaccuracy', 'mistake', 'miss', 'blunder']);
/** Classes where the played move already was the best (the Best button stays disabled). */
const BEST_FREE: ReadonlySet<MoveClass> = new Set<MoveClass>(['best', 'great', 'brilliant', 'book', 'forced']);

const GRAPH_CLASSES: ReadonlySet<MoveClass> = new Set<MoveClass>(['brilliant', 'great', 'miss', 'mistake', 'blunder', 'inaccuracy']);

function play(kind: ReturnType<typeof soundKind>) {
  sfx[kind]();
}

/** The placeholder shown while the game (or the decision about it) loads. */
function ReviewLoading() {
  return (
    <div className="mx-auto max-w-xl space-y-3 pt-6">
      <div className="h-40 animate-pulse rounded-2xl bg-ink-850" role="status" aria-label="Loading game" />
    </div>
  );
}

type Gate = { phase: 'loading' } | { phase: 'review' } | { phase: 'ask'; game: StoredGame; parsed: ParsedGame; side: Side };

/**
 * Route-level entry and gate. Decides once per game whether the player reviews it themselves before the engine
 * runs. While it loads, and while the question is shown, the component that owns the analysis session is not
 * mounted, so no session and no engine worker exist. Once it has decided it never changes its mind: a saved
 * analysis or a changed setting cannot bring the question back or remount the review.
 */
export function ReviewPage({ gameKey }: { gameKey: string }) {
  const [gate, setGate] = useState<Gate>({ phase: 'loading' });
  useEffect(() => {
    let live = true;
    const settle = (next: Gate) => {
      if (live) setGate((prev) => (prev.phase === 'loading' ? next : prev));
    };
    loadGateInputs(gameKey).then(
      (inp) => {
        // Mode off, game missing or unreadable: the review itself shows the right state.
        if (!inp || !inp.game) return settle({ phase: 'review' });
        const parsed = parsePgnGame(inp.game.pgn);
        if (!parsed.ok) return settle({ phase: 'review' });
        const side = resolveSide(inp.game, inp.prefs);
        const ask = needsSelfReview({ mode: inp.mode, game: inp.game, side, hasAnalysis: inp.hasAnalysis, review: inp.review });
        settle(ask && side ? { phase: 'ask', game: inp.game, parsed: parsed.game, side } : { phase: 'review' });
      },
      () => settle({ phase: 'review' }),
    );
    return () => {
      live = false;
    };
  }, [gameKey]);

  if (gate.phase === 'loading') return <ReviewLoading />;
  if (gate.phase === 'ask') return <SelfReviewGate game={gate.game} parsed={gate.parsed} side={gate.side} onDone={() => setGate({ phase: 'review' })} />;
  return <ReviewSession gameKey={gameKey} />;
}

/** The review of one game: picks the right state, the review itself only mounts once the game is loaded. */
function ReviewSession({ gameKey }: { gameKey: string }) {
  const s = useAnalysisSession(gameKey);
  if (s.status === 'missing') {
    return (
      <div className="mx-auto max-w-xl pt-6">
        <EmptyState
          icon={Icons.search('h-6 w-6')}
          title="Game not found"
          action={<Link to="/analysis" className="font-bold text-ember-400">Back to Game Review</Link>}
        >
          This game is not stored on this device. Import it again from the Game Review page.
        </EmptyState>
      </div>
    );
  }
  if (!s.game || !s.parsed) {
    if (s.status !== 'error') return <ReviewLoading />;
    return (
      <div className="mx-auto max-w-xl space-y-3 pt-6">
        <Panel className="space-y-3 text-center">
          <p className="text-bad-400">{s.error}</p>
          <Link to="/analysis" className="font-bold text-ember-400">Back to Game Review</Link>
        </Panel>
      </div>
    );
  }
  return <ReviewBody s={s} gameKey={gameKey} />;
}

interface Step {
  fen: string;
  san: string;
  from: string;
  to: string;
}

interface Exploration {
  startFen: string;
  basePly: number;
  moves: Step[];
  cursor: number;
}

/** Retry: the user replays the position before the move at ply. */
interface RetryRun {
  /** move.ply of the retried move. */
  ply: number;
  state: RetryState;
  /** The move the user just tried (shown on the board). */
  tried: Step | null;
}

interface Preview {
  /** explain = the opponent punishing line (red arrows), best = the engine line before the move. */
  kind: 'best' | 'explain';
  startFen: string;
  steps: LineStep[];
  /** -1 = start, steps.length = holding on the last position. */
  idx: number;
}

const ReviewBoard = memo(function ReviewBoard(props: {
  fen: string;
  orientation: 'white' | 'black';
  lastMove: [string, string] | null;
  tints: Record<string, string> | undefined;
  arrows: BoardArrow[] | undefined;
  pulse: string[] | undefined;
  interactive: boolean;
  movableColor: 'w' | 'b';
  onMove: (uci: string) => void;
  positionKey: string;
  badge: ReactNode;
}) {
  const { badge, fen, ...rest } = props;
  return (
    <Board fen={fen} annotationKey={fen} {...rest}>
      {badge}
    </Board>
  );
});

function ReviewBody({ s, gameKey }: { s: ReturnType<typeof useAnalysisSession>; gameKey: string }) {
  const { game, parsed, report, evals, status, engine } = s;
  // Both are non-null here (checked by the caller).
  const g = game!;
  const p = parsed!;
  const [search, setSearch] = useSearchParams();

  const moves = useMemo(() => report?.moves ?? provisionalMoves(p), [report, p]);
  const N = moves.length;
  const classified = report !== null;

  const mySide = userSide(g);
  const [flipped, setFlipped] = useState(false);
  const [mode, setMode] = useState<'summary' | 'review'>(() => (search.get('ply') ? 'review' : 'summary'));
  const [playing, setPlaying] = useState(false);
  const orientation: 'white' | 'black' = (mySide === 'b') !== flipped ? 'black' : 'white';

  const [ply, setPly] = useState(() => initialPly(search.get('ply'), p.sans.length));
  const [explore, setExplore] = useState<Exploration | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [live, setLive] = useState<{ fen: string; e: PositionEval } | null>(null);
  const [retry, setRetry] = useState<RetryRun | null>(null);
  const [tipMode, setTipMode] = useState<TipMode>('move');
  const [classFilter, setClassFilter] = useState<{ side: Side; cls: MoveClass } | null>(null);

  /* URL sync */
  useEffect(() => {
    const current = search.get('ply');
    const want = ply === 0 ? null : String(ply);
    if (current === want) return;
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (want === null) next.delete('ply');
        else next.set('ply', want);
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ply]);

  /* Navigation */
  const plyRef = useRef(ply);
  plyRef.current = ply;
  const exploreRef = useRef(explore);
  exploreRef.current = explore;
  const goTo = useCallback(
    (index: number, sound = true) => {
      const next = Math.max(0, Math.min(N, index));
      if (sound && (next !== plyRef.current || exploreRef.current) && next > 0) play(soundKind(moves[next - 1].san));
      setPreview(null);
      setExplore(null);
      setRetry(null);
      setTipMode('move');
      setPly(next);
    },
    [N, moves],
  );
  const seek = useCallback((i: number) => goTo(i, false), [goTo]);

  const exploring = explore !== null;
  const setCursor = useCallback((c: number) => {
    const ex = exploreRef.current;
    if (!ex) return;
    const cursor = Math.max(0, Math.min(ex.moves.length, c));
    if (cursor === ex.cursor) return;
    if (cursor > 0) play(soundKind(ex.moves[cursor - 1].san));
    setExplore({ ...ex, cursor });
  }, []);

  const step = (d: number) => {
    if (explore) setCursor(explore.cursor + d);
    else goTo(ply + d);
  };

  /* What the board shows */
  const retryMove = retry ? moves[retry.ply] : null;
  const view = useMemo(() => {
    if (retry && retryMove) {
      const st = retry.tried;
      return { fen: st ? st.fen : retryMove.fenBefore, last: st ? ([st.from, st.to] as [string, string]) : null };
    }
    if (preview) {
      const i = Math.min(preview.idx, preview.steps.length - 1);
      const st = i >= 0 ? preview.steps[i] : null;
      return { fen: st ? st.fen : preview.startFen, last: st ? ([st.from, st.to] as [string, string]) : null };
    }
    if (explore) {
      const st = explore.cursor > 0 ? explore.moves[explore.cursor - 1] : null;
      return { fen: st ? st.fen : explore.startFen, last: st ? ([st.from, st.to] as [string, string]) : null };
    }
    const m = ply > 0 ? moves[ply - 1] : null;
    return { fen: p.fens[ply], last: m ? ([m.uci.slice(0, 2), m.uci.slice(2, 4)] as [string, string]) : null };
  }, [retry, retryMove, preview, explore, ply, moves, p]);

  const move = !exploring && !preview && !retry && ply > 0 ? moves[ply - 1] : null;
  const shownMove = ply > 0 ? moves[ply - 1] : null;

  const arrows = useMemo<BoardArrow[] | undefined>(() => {
    if (retry) return undefined;
    if (preview) {
      // Explain walks the opponent line: the first position shows the threat, every move after it is drawn in red.
      if (preview.kind !== 'explain') return undefined;
      const st = preview.idx >= 0 ? preview.steps[Math.min(preview.idx, preview.steps.length - 1)] : null;
      if (st) return [{ from: st.from, to: st.to, color: 'red' }];
      const t = shownMove?.insight?.threat;
      return t ? [{ from: t.from, to: t.to, color: 'red' }] : undefined;
    }
    if (!move || !classified) return undefined;
    const out: BoardArrow[] = [];
    if (move.best && move.best.uci !== move.uci) out.push({ from: move.best.uci.slice(0, 2), to: move.best.uci.slice(2, 4), color: 'green' });
    const t = move.insight?.threat;
    if (t) out.push({ from: t.from, to: t.to, color: 'red' });
    return out.length ? out : undefined;
  }, [move, classified, preview, retry, shownMove]);

  const badge = useMemo(
    () => (move && classified ? <MoveBadge square={move.uci.slice(2, 4)} orientation={orientation} cls={move.class} /> : null),
    [move, classified, orientation],
  );

  const tints = useMemo<Record<string, string> | undefined>(() => {
    if (retry) {
      const st = retry.tried;
      if (!st) return undefined;
      const key = retry.state.phase === 'best' ? 'best' : retry.state.phase === 'good' ? 'good' : 'blunder';
      const c = `${MOVE_CLASS_META[key].color}73`;
      return { [st.from]: c, [st.to]: c };
    }
    if (!move || !classified || preview) return undefined;
    const c = `${MOVE_CLASS_META[move.class].color}73`; // ~45% opacity
    return { [move.uci.slice(0, 2)]: c, [move.uci.slice(2, 4)]: c };
  }, [move, classified, preview, retry]);

  /* Dragging a move */
  const latest = useRef({ ply, explore, view, moves, N, retry, evals });
  latest.current = { ply, explore, view, moves, N, retry, evals };
  const onMove = useCallback(
    (uci: string) => {
      const { ply: cur, explore: ex, view: v, moves: ms, N: n, retry: rt, evals: evs } = latest.current;
      if (rt) {
        // Retry has priority over exploring: judge the move against the stored engine lines.
        if (!retryCanMove(rt.state)) return;
        const mv = ms[rt.ply];
        const r = playUci(mv.fenBefore, uci);
        if (!r) return;
        const verdict = judgeRetryMove(evs[mv.ply], uci, mv.color);
        if (verdict === 'best') sfx.correct();
        else if (verdict === 'wrong') sfx.wrong();
        else play(soundKind(r.san));
        setRetry({ ply: rt.ply, state: retryJudge(rt.state, verdict), tried: { fen: r.fen, san: r.san, from: r.from, to: r.to } });
        return;
      }
      if (!ex && cur < n && ms[cur].uci === uci) {
        goTo(cur + 1);
        return;
      }
      const r = playUci(v.fen, uci);
      if (!r) return;
      play(soundKind(r.san));
      const st: Step = { fen: r.fen, san: r.san, from: r.from, to: r.to };
      setPreview(null);
      setTipMode('move');
      setExplore(ex ? { ...ex, moves: [...ex.moves.slice(0, ex.cursor), st], cursor: ex.cursor + 1 } : { startFen: v.fen, basePly: cur, moves: [st], cursor: 1 });
    },
    [goTo],
  );

  /* Live engine lines while exploring */
  const exploreFen = explore ? view.fen : null;
  useEffect(() => {
    if (!exploreFen) {
      setLive(null);
      return;
    }
    const ctl = new AbortController();
    let raf = 0;
    let latestEval: PositionEval | null = null;
    setLive(null);
    try {
      void getEnginePool(engine)
        .evaluate({
          fen: exploreFen,
          depth: 99,
          infinite: true,
          multiPv: 3,
          priority: 10,
          signal: ctl.signal,
          onUpdate: (e) => {
            latestEval = e;
            if (!raf) {
              raf = requestAnimationFrame(() => {
                raf = 0;
                if (latestEval && !ctl.signal.aborted) setLive({ fen: exploreFen, e: latestEval });
              });
            }
          },
        })
        .catch(() => undefined);
    } catch {
      /* no engine available: the panel keeps showing "thinking" */
    }
    return () => {
      ctl.abort();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [exploreFen, engine]);

  /* "Show line": walk the best line, hold, return */
  useEffect(() => {
    if (!preview) return;
    const holding = preview.idx >= preview.steps.length;
    const t = setTimeout(
      () => {
        if (holding) {
          setPreview(null);
          return;
        }
        const next = preview.idx + 1;
        if (next < preview.steps.length) play(soundKind(preview.steps[next].san));
        setPreview({ ...preview, idx: next });
      },
      (holding ? 1000 : 750) * motionScale(),
    );
    return () => clearTimeout(t);
  }, [preview]);

  /* Retry: a wrong move stays on the board for a beat, then the position resets */
  const retryWrong = retry?.state.phase === 'wrong';
  useEffect(() => {
    if (!retryWrong) return;
    const t = setTimeout(() => setRetry((r) => (r ? { ...r, state: retryResume(r.state), tried: null } : r)), 900 * motionScale());
    return () => clearTimeout(t);
  }, [retryWrong]);

  const bestPv = shownMove && report ? report.evals[shownMove.ply]?.lines[0]?.pv : undefined;
  const bestLine = useMemo(() => (shownMove && bestPv ? lineToSan(shownMove.fenBefore, bestPv, 8) : []), [shownMove, bestPv]);
  const showLine = () => {
    if (!shownMove || !bestPv || exploreRef.current) return;
    const steps = lineSteps(shownMove.fenBefore, bestPv, 8);
    if (steps.length) {
      setRetry(null);
      setPreview({ kind: 'best', startFen: shownMove.fenBefore, steps, idx: -1 });
    }
  };

  /* Explain / Best / Retry buttons */
  const canBest = !!shownMove && !exploring && !!bestPv && !!shownMove.best && shownMove.best.uci !== shownMove.uci && !BEST_FREE.has(shownMove.class);
  const explainText = shownMove && classified ? coachExplainText(shownMove, shownMove.insight, mySide) : '';
  const explainPv = shownMove && report ? report.evals[shownMove.ply + 1]?.lines[0]?.pv : undefined;
  const canExplain = !!shownMove && !exploring && classified && explainText !== '';
  const canRetry = !!shownMove && !exploring && classified && RETRY_CLASSES.has(shownMove.class) && !!evals[shownMove.ply]?.lines.length;
  const toggleExplain = () => {
    if (!shownMove || !canExplain) return;
    if (tipMode === 'explain') {
      setPreview(null);
      setTipMode('move');
      return;
    }
    setRetry(null);
    setPlaying(false);
    setTipMode('explain');
    const steps = explainPv ? lineSteps(shownMove.fenAfter, explainPv, 5) : [];
    setPreview(steps.length ? { kind: 'explain', startFen: shownMove.fenAfter, steps, idx: -1 } : null);
  };
  const toggleBest = () => {
    if (!canBest) return;
    if (tipMode === 'best') {
      setPreview(null);
      setTipMode('move');
      return;
    }
    setPlaying(false);
    setTipMode('best');
    showLine();
  };
  const toggleRetry = () => {
    if (!shownMove || !canRetry) return;
    if (retry && !retryFinished(retry.state)) {
      setRetry(null);
      return;
    }
    setPreview(null);
    setPlaying(false);
    setTipMode('move');
    setRetry({ ply: shownMove.ply, state: retryStart(), tried: null });
  };
  const showAnswer = () => {
    setTipMode('best');
    showLine();
  };

  // Entering review mode from the long summary: start at the top so the board and controls are on screen.
  useEffect(() => {
    if (mode === 'review') window.scrollTo(0, 0);
  }, [mode]);

  /* Hotkeys */
  const reviewing = classified && mode === 'review';
  const enterReview = () => {
    if (classified && mode === 'summary') setMode('review');
  };
  const first = () => {
    enterReview();
    if (explore) setCursor(0);
    else goTo(0);
  };
  const last = () => {
    enterReview();
    if (explore) setCursor(explore.moves.length);
    else goTo(N);
  };
  const stepBy = (d: number) => {
    enterReview();
    setPlaying(false);
    step(d);
  };

  /* Autoplay: one move per second until the end */
  useEffect(() => {
    if (!playing) return;
    if (explore || preview || retry || ply >= N) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => goTo(plyRef.current + 1), 1000);
    return () => clearTimeout(t);
  }, [playing, ply, explore, preview, retry, N, goTo]);

  const help = useHotkeysWithHelp({
    arrowleft: () => stepBy(-1),
    arrowup: () => stepBy(-1),
    arrowright: () => stepBy(1),
    arrowdown: () => stepBy(1),
    home: first,
    end: last,
    f: () => setFlipped((f) => !f),
    escape: () => {
      if (explore || preview || retry || tipMode !== 'move') {
        setExplore(null);
        setPreview(null);
        setRetry(null);
        setTipMode('move');
        return true;
      }
      return false;
    },
  });

  /* Eval shown in the bar */
  const shownEval: PositionEval | undefined = exploring ? (live && live.fen === view.fen ? live.e : undefined) : evals[retry || preview?.kind === 'best' ? Math.max(0, ply - 1) : ply];
  const fraction = barFraction(shownEval);

  /* Graph */
  const geom = useMemo(() => graphGeometry(evals, GRAPH_W, GRAPH_H, 4), [evals]);
  const dots = useMemo<GraphDot[]>(() => {
    if (!report) return [];
    const out: GraphDot[] = [];
    for (const m of report.moves) {
      if (!GRAPH_CLASSES.has(m.class)) continue;
      const pt = geom.points[m.ply + 1];
      if (pt) out.push({ key: m.ply, x: pt.x, y: pt.y, color: MOVE_CLASS_META[m.class].color, label: `${m.san}: ${MOVE_CLASS_META[m.class].label}` });
    }
    return out;
  }, [report, geom]);

  /* Practise */
  // The side comes from the import username or the remembered one; when neither matches the player picks it.
  const prefs = useAnalysisPrefs();
  const knownSide = resolveSide(g, prefs ?? { lichessUser: '', chesscomUser: '' });
  const [pickedSide, setPickedSide] = useState<Side | null>(null);
  const practiseSide = knownSide ?? pickedSide;
  const gamePuzzles = useMemo(() => (report && practiseSide ? practicePuzzles(g, report, practiseSide) : []), [g, report, practiseSide]);
  const mistakeCount = gamePuzzles.length;
  const puzzleIds = useMemo(() => new Set(gamePuzzles.map((q) => q.id)), [gamePuzzles]);
  const picks = useNextPicks();
  const slot = woodSlotState({ gameKey: g.key, move: exploring ? null : shownMove, classified, side: practiseSide, puzzleIds, picks: picks ?? [] });
  const [adding, setAdding] = useState(false);
  const addToWoodpecker = async () => {
    if (slot.kind !== 'add' || !practiseSide || adding) return;
    const puzzle = gamePuzzles.find((q) => q.id === slot.puzzleId);
    if (!puzzle) return;
    setAdding(true);
    try {
      const added = await addToNextSet(puzzle, g, practiseSide);
      toast(added ? { title: 'Added to your next Woodpecker set', icon: 'target', tone: 'good', to: '/train/woodpecker' } : { title: 'Already in your next set', icon: 'check', tone: 'sky' });
    } catch {
      toast({ title: 'Could not add the puzzle', body: 'Please try again.', icon: 'x', tone: 'ember' });
    } finally {
      setAdding(false);
    }
  };
  const [busy, setBusy] = useState(false);
  const practise = async (chosen?: Side) => {
    const side = practiseSide ?? chosen;
    if (!report || !side || busy) return;
    if (chosen && !knownSide) setPickedSide(chosen);
    setBusy(true);
    try {
      const r = await addMistakesToPractice(g, report, side);
      toast({
        title: r.added > 0 ? `Added ${r.added} puzzle${r.added === 1 ? '' : 's'} to practice` : 'Already in your practice queue',
        body: r.queued > 0 ? `${r.queued} due now in Review mistakes` : 'Open Review mistakes to play them',
        icon: 'target',
        tone: 'good',
        to: '/train/review',
      });
    } catch {
      toast({ title: 'Could not add the puzzles', body: 'Please try again.', icon: 'x', tone: 'ember' });
    } finally {
      setBusy(false);
    }
  };

  const boardFen = view.fen;
  const movableColor = retryMove ? retryMove.color : sideToMoveOf(boardFen);
  const curIndex = explore ? explore.basePly : ply;

  const startLabel = useMemo(() => {
    if (!explore) return { number: 1, black: false };
    const f = explore.startFen.split(' ');
    return { number: Number(f[5]) || 1, black: f[1] === 'b' };
  }, [explore]);

  // Hint after two wrong tries: light up the piece the engine would move.
  const retryPulse = useMemo(() => {
    if (!retry || !retryHint(retry.state)) return undefined;
    const best = moves[retry.ply]?.best?.uci;
    return best ? [best.slice(0, 2)] : undefined;
  }, [retry, moves]);

  // Phones in review mode: the board column is capped so board + coach strip + action row + nav bar fit one screen.
  const phoneCoach = report !== null && mode === 'review';
  const board = (
    <div className={phoneCoach ? 'max-lg:mx-auto max-lg:max-w-[max(15rem,calc(100dvh-29rem))]' : undefined}>
      <div className="flex items-stretch gap-2">
        <EvalBar fraction={fraction} e={shownEval} orientation={orientation} />
        <div className="min-w-0 flex-1">
          <ReviewBoard
            fen={boardFen}
            orientation={orientation}
            lastMove={view.last}
            tints={tints}
            arrows={arrows}
            pulse={retryPulse}
            interactive={retry ? retryCanMove(retry.state) : !preview}
            movableColor={movableColor}
            onMove={onMove}
            positionKey={gameKey}
            badge={preview || retry ? null : badge}
          />
        </div>
      </div>
      <div className="mt-1 flex items-center justify-end gap-1.5 lg:mt-3">
        {report && mode === 'summary' && (
          // Phones: the summary is long and its Start Review button sits at the bottom; this one is right here.
          <Button
            size="sm"
            variant="good"
            className="mr-auto lg:hidden"
            onClick={() => {
              goTo(0, false);
              setMode('review');
            }}
          >
            Start Review
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setFlipped((f) => !f)} aria-label="Flip board (F)">
          {Icons.flip('h-4 w-4')} Flip
        </Button>
        <Button size="sm" variant="ghost" onClick={help.openHelp} aria-label="Keyboard shortcuts">?</Button>
      </div>
    </div>
  );

  const startReview = () => {
    goTo(0, false);
    setMode('review');
  };
  const filterPlies = useMemo(() => (classFilter ? movesOfClass(moves, classFilter.side, classFilter.cls) : []), [classFilter, moves]);
  const openClass = (side: Side, cls: MoveClass) => {
    const plies = movesOfClass(moves, side, cls);
    if (!plies.length) return;
    setClassFilter({ side, cls });
    goTo(plies[0] + 1, false);
    setMode('review');
  };
  const stepFilter = (dir: 1 | -1) => {
    const target = stepInClass(filterPlies, ply - 1, dir);
    if (target === null) return;
    setPlaying(false);
    goTo(target + 1);
  };
  const filterView: ClassFilterView | null =
    classFilter && filterPlies.length ? { ...classFilter, index: positionInClass(filterPlies, ply - 1), total: filterPlies.length } : null;
  const retryInfo = retry && retryMove ? retryMessage(retry.state, retryMove.san) : null;
  const actions: ReviewActions = {
    canExplain,
    canBest,
    canRetry,
    canNext: ply < N,
    explainOn: tipMode === 'explain',
    bestOn: tipMode === 'best',
    retryOn: !!retry,
  };
  const seekFromSummary = (i: number) => {
    goTo(i, false);
    setMode('review');
  };

  /* Your own review of the game, made before the engine ran */
  const selfRaw = useSelfReviewRow(gameKey);
  const selfRow = useMemo(() => cleanSelfReviewRow(selfRaw, N), [selfRaw, N]);
  const selfResult = useMemo(() => (selfRow && !selfRow.skipped && report ? selfReviewResult(selfRow, report) : null), [selfRow, report]);
  const openEnginePoint = (enginePly: number, withRetry: boolean) => {
    goTo(enginePly + 1, false);
    setClassFilter(null);
    setMode('review');
    // goTo cleared Retry; the last state set wins, so this starts it on the engine's move.
    if (withRetry) setRetry({ ply: enginePly, state: retryStart(), tried: null });
  };
  const enginePly = selfResult?.enginePly ?? null;
  const engineMove = enginePly !== null ? moves[enginePly] : undefined;
  const cardCanRetry = !!engineMove && enginePly !== null && classified && RETRY_CLASSES.has(engineMove.class) && !!evals[enginePly]?.lines.length;
  const engineState: EngineState = report ? 'ready' : status === 'analysing' || status === 'loading' ? 'waiting' : 'none';
  const selfCard =
    selfRow && !selfRow.skipped ? (
      <ComparisonCard
        row={selfRow}
        result={selfResult}
        engine={engineState}
        mineLabel={selfRow.turningPly !== null && moves[selfRow.turningPly] ? moveLabel(moves[selfRow.turningPly]) : null}
        canRetry={cardCanRetry}
        onRetry={(ply) => openEnginePoint(ply, true)}
        onShow={(ply) => openEnginePoint(ply, false)}
      />
    ) : null;

  const panel = (() => {
    if (!report) {
      // Analysis still running (or failed): the live graph instead of the summary.
      return (
        <div className="space-y-3">
          {selfCard}
          <p className="text-sm text-ink-300">{status === 'analysing' ? 'Analysing the game\u2026 the graph fills in as positions are evaluated.' : 'No analysis yet.'}</p>
          <EvalGraph geom={geom} count={N + 1} current={curIndex} dots={dots} onSeek={seek} />
        </div>
      );
    }
    if (!reviewing) {
      return (
        <div className="space-y-4">
          {selfCard}
          <SummaryView
            report={report}
            game={g}
            mySide={mySide}
            geom={geom}
            dots={dots}
            mistakeCount={mistakeCount}
            sideKnown={practiseSide !== null}
            practiseBusy={busy}
            staleEngine={s.staleEngine}
            onStart={startReview}
            onSeek={seekFromSummary}
            onOpenClass={openClass}
            onPractise={(chosen) => void practise(chosen)}
            onReanalyse={() => s.restart('lite')}
          />
        </div>
      );
    }
    return (
      <ReviewView
        moves={moves}
        move={shownMove}
        ply={curIndex}
        evalAfter={evals[ply]}
        bestLine={bestLine}
        previewing={preview !== null}
        explorePanel={
          explore ? (
            <ExplorePanel
              fen={view.fen}
              live={live && live.fen === view.fen ? live.e : null}
              sans={explore.moves.map((m) => m.san)}
              startLabel={startLabel}
              cursor={explore.cursor}
              onCursor={setCursor}
              onBack={() => setExplore(null)}
            />
          ) : null
        }
        geom={geom}
        dots={dots}
        playing={playing}
        perspective={mySide}
        tipMode={tipMode}
        retry={retryInfo}
        filter={filterView}
        actions={actions}
        woodSlot={<WoodSlot state={slot} busy={adding} onAdd={() => void addToWoodpecker()} />}
        onExplain={toggleExplain}
        onBest={toggleBest}
        onRetry={toggleRetry}
        onShowAnswer={showAnswer}
        onFilterStep={stepFilter}
        onFilterClear={() => setClassFilter(null)}
        onShowLine={showLine}
        onSummary={() => {
          setPlaying(false);
          setExplore(null);
          setPreview(null);
          setRetry(null);
          setClassFilter(null);
          setMode('summary');
        }}
        onFirst={first}
        onBack={() => stepBy(-1)}
        onNext={() => stepBy(1)}
        onLast={last}
        onTogglePlay={() => setPlaying((v) => !v)}
        onSelect={(i) => {
          setPlaying(false);
          goTo(i);
        }}
        onSeek={seek}
      />
    );
  })();

  const side$ = <Panel>{panel}</Panel>;

  return (
    <div className="w-full">
      <ReviewHeader game={g} report={report} />
      {status === 'analysing' && <ProgressBar done={s.done} total={s.total} engineLabel={ENGINES[engine].label} depth={s.depth} onCancel={s.cancel} />}
      {status === 'error' && (
        <div className="mx-auto mb-4 flex w-full max-w-6xl items-center justify-between gap-3 rounded-xl border border-bad-500/40 bg-bad-500/10 px-4 py-3 text-sm" role="alert">
          <span className="text-bad-400">{s.error}</span>
          <Button size="sm" variant="secondary" onClick={() => s.restart()}>Retry</Button>
        </div>
      )}
      <GameLayout
        board={board}
        side={side$}
        wideSide
        top={
          phoneCoach ? (
            <div className="mb-2 lg:hidden">
              <PhoneCoach
                move={shownMove}
                evalAfter={evals[ply]}
                bestLine={bestLine}
                previewing={preview !== null}
                exploring={exploring}
                perspective={mySide}
                tipMode={tipMode}
                retry={retryInfo}
                onShowLine={showLine}
                onShowAnswer={showAnswer}
              />
            </div>
          ) : undefined
        }
        dock={
          report && reviewing ? (
            <div className="space-y-2 lg:hidden">
              <ActionRow a={actions} onExplain={toggleExplain} onBest={toggleBest} onRetry={toggleRetry} onNext={() => stepBy(1)} />
              <ReviewNav explore={!!explore} ply={curIndex} count={N} playing={playing} onFirst={first} onBack={() => stepBy(-1)} onNext={() => stepBy(1)} onLast={last} onTogglePlay={() => setPlaying((v) => !v)} />
            </div>
          ) : undefined
        }
      />
      <ShortcutHelp open={help.helpOpen} onClose={help.closeHelp} groups={SHORTCUTS} />
    </div>
  );
}
