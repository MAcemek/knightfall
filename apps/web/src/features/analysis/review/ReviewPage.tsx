import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PositionEval } from '@knightfall/core';
import { addMistakesToPractice, practicePuzzles, useAnalysisSession } from '../../../shared/analysis/index.ts';
import { Board, type BoardArrow } from '../../../shared/Board/index.ts';
import { ENGINES, getEnginePool } from '../../../shared/engine/index.ts';
import { sfx } from '../../../shared/fx/index.ts';
import { motionScale } from '../../../shared/settings.ts';
import { BOARD_SHORTCUTS, ShortcutHelp, type ShortcutGroup } from '../../../shared/ShortcutHelp.tsx';
import { toast } from '../../../shared/toast.tsx';
import { Button, EmptyState, GameLayout, Icons, Panel } from '../../../shared/ui.tsx';
import { useHotkeysWithHelp } from '../../puzzles/useHotkeys.ts';
import {
  EvalBar, EvalGraph, ExplainPanel, ExplorePanel, GRAPH_H, GRAPH_W, MoveBadge, MoveList, ProgressBar, ReviewHeader, SummaryPanel,
  type GraphDot,
} from './parts.tsx';
import { lineSteps, provisionalMoves, sideToMoveOf, soundKind, userSide, type LineStep } from './reviewExtras.ts';
import { barFraction, graphGeometry, initialPly, lineToSan, playUci } from './reviewLogic.ts';
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
      { keys: ['Esc'], label: 'Leave a variation' },
      { keys: ['?'], label: 'Show this help' },
    ],
  },
  { title: 'Explore', items: [{ keys: ['Drag'], label: 'Play a different move to start a variation' }] },
  BOARD_SHORTCUTS,
];

function play(kind: ReturnType<typeof soundKind>) {
  sfx[kind]();
}

/** Route-level entry: picks the right state, the review itself only mounts once the game is loaded. */
export function ReviewPage({ gameKey }: { gameKey: string }) {
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
    return (
      <div className="mx-auto max-w-xl space-y-3 pt-6">
        {s.status === 'error' ? (
          <Panel className="space-y-3 text-center">
            <p className="text-bad-400">{s.error}</p>
            <Link to="/analysis" className="font-bold text-ember-400">Back to Game Review</Link>
          </Panel>
        ) : (
          <div className="h-40 animate-pulse rounded-2xl bg-ink-850" role="status" aria-label="Loading game" />
        )}
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

interface Preview {
  startFen: string;
  steps: LineStep[];
  /** -1 = start, steps.length = holding on the last position. */
  idx: number;
}

const ReviewBoard = memo(function ReviewBoard(props: {
  fen: string;
  orientation: 'white' | 'black';
  lastMove: [string, string] | null;
  arrows: BoardArrow[] | undefined;
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
  const orientation: 'white' | 'black' = (mySide === 'b') !== flipped ? 'black' : 'white';

  const [ply, setPly] = useState(() => initialPly(search.get('ply'), p.sans.length));
  const [explore, setExplore] = useState<Exploration | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [live, setLive] = useState<{ fen: string; e: PositionEval } | null>(null);

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
  const view = useMemo(() => {
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
  }, [preview, explore, ply, moves, p]);

  const move = !exploring && !preview && ply > 0 ? moves[ply - 1] : null;
  const shownMove = ply > 0 ? moves[ply - 1] : null;

  const arrows = useMemo<BoardArrow[] | undefined>(() => {
    if (!move || !classified || !move.best || move.best.uci === move.uci) return undefined;
    return [{ from: move.best.uci.slice(0, 2), to: move.best.uci.slice(2, 4), color: 'green' }];
  }, [move, classified]);

  const badge = useMemo(
    () => (move && classified ? <MoveBadge square={move.uci.slice(2, 4)} orientation={orientation} cls={move.class} /> : null),
    [move, classified, orientation],
  );

  /* Dragging a move */
  const latest = useRef({ ply, explore, view, moves, N });
  latest.current = { ply, explore, view, moves, N };
  const onMove = useCallback(
    (uci: string) => {
      const { ply: cur, explore: ex, view: v, moves: ms, N: n } = latest.current;
      if (!ex && cur < n && ms[cur].uci === uci) {
        goTo(cur + 1);
        return;
      }
      const r = playUci(v.fen, uci);
      if (!r) return;
      play(soundKind(r.san));
      const st: Step = { fen: r.fen, san: r.san, from: r.from, to: r.to };
      setPreview(null);
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

  const bestPv = move && report ? report.evals[move.ply]?.lines[0]?.pv : undefined;
  const bestLine = useMemo(() => (move && bestPv ? lineToSan(move.fenBefore, bestPv, 8) : []), [move, bestPv]);
  const showLine = () => {
    if (!move || !bestPv) return;
    const steps = lineSteps(move.fenBefore, bestPv, 8);
    if (steps.length) setPreview({ startFen: move.fenBefore, steps, idx: -1 });
  };

  /* Hotkeys */
  const help = useHotkeysWithHelp({
    arrowleft: () => step(-1),
    arrowup: () => step(-1),
    arrowright: () => step(1),
    arrowdown: () => step(1),
    home: () => (explore ? setCursor(0) : goTo(0)),
    end: () => (explore ? setCursor(explore.moves.length) : goTo(N)),
    f: () => setFlipped((f) => !f),
    escape: () => {
      if (explore || preview) {
        setExplore(null);
        setPreview(null);
        return true;
      }
      return false;
    },
  });

  /* Eval shown in the bar */
  const shownEval: PositionEval | undefined = exploring ? (live && live.fen === view.fen ? live.e : undefined) : evals[preview ? Math.max(0, ply - 1) : ply];
  const fraction = barFraction(shownEval);

  /* Graph */
  const geom = useMemo(() => graphGeometry(evals, GRAPH_W, GRAPH_H, 4), [evals]);
  const dots = useMemo<GraphDot[]>(() => {
    if (!report) return [];
    const out: GraphDot[] = [];
    for (const m of report.moves) {
      if (m.class !== 'blunder' && m.class !== 'mistake' && m.class !== 'miss') continue;
      const pt = geom.points[m.ply + 1];
      if (pt) out.push({ key: m.ply, x: pt.x, y: pt.y, color: MOVE_CLASS_META[m.class].color, label: `${m.san}: ${MOVE_CLASS_META[m.class].label}` });
    }
    return out;
  }, [report, geom]);

  /* Practise */
  const side = mySide ?? 'w';
  const mistakeCount = useMemo(() => (report ? practicePuzzles(g, report, side).length : 0), [g, report, side]);
  const [busy, setBusy] = useState(false);
  const practise = async () => {
    if (!report || busy) return;
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
  const movableColor = sideToMoveOf(boardFen);
  const curIndex = explore ? explore.basePly : ply;

  const startLabel = useMemo(() => {
    if (!explore) return { number: 1, black: false };
    const f = explore.startFen.split(' ');
    return { number: Number(f[5]) || 1, black: f[1] === 'b' };
  }, [explore]);

  const board = (
    <div>
      <div className="flex items-stretch gap-2">
        <EvalBar fraction={fraction} e={shownEval} orientation={orientation} />
        <div className="min-w-0 flex-1">
          <ReviewBoard
            fen={boardFen}
            orientation={orientation}
            lastMove={view.last}
            arrows={preview ? undefined : arrows}
            interactive={!preview}
            movableColor={movableColor}
            onMove={onMove}
            positionKey={gameKey}
            badge={preview ? null : badge}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" aria-label="First move" onClick={() => (explore ? setCursor(0) : goTo(0))}>«</Button>
          <Button size="sm" variant="secondary" aria-label="Previous move" onClick={() => step(-1)}>‹</Button>
          <Button size="sm" variant="secondary" aria-label="Next move" onClick={() => step(1)}>›</Button>
          <Button size="sm" variant="secondary" aria-label="Last move" onClick={() => (explore ? setCursor(explore.moves.length) : goTo(N))}>»</Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setFlipped((f) => !f)} aria-label="Flip board (F)">
            {Icons.flip('h-4 w-4')} Flip
          </Button>
          <Button size="sm" variant="ghost" onClick={help.openHelp} aria-label="Keyboard shortcuts">?</Button>
        </div>
      </div>
      <div className="mt-3">
        <EvalGraph geom={geom} count={N + 1} current={curIndex} dots={dots} onSeek={seek} />
      </div>
    </div>
  );

  const side$ = (
    <div className="space-y-4">
      <Panel>
        {explore ? (
          <ExplorePanel
            fen={view.fen}
            live={live && live.fen === view.fen ? live.e : null}
            sans={explore.moves.map((m) => m.san)}
            startLabel={startLabel}
            cursor={explore.cursor}
            onCursor={setCursor}
            onBack={() => setExplore(null)}
          />
        ) : (
          <ExplainPanel move={shownMove} report={report} onShowLine={showLine} previewing={preview !== null} bestLine={bestLine} />
        )}
      </Panel>
      <Panel>
        <MoveList moves={moves} classified={classified} current={explore ? explore.basePly : ply} onSelect={goTo} />
      </Panel>
      {report && game && (
        <Panel className="space-y-2">
          <Button variant="good" className="w-full" disabled={mistakeCount === 0 || busy} onClick={() => void practise()}>
            Practise {mistakeCount} mistake{mistakeCount === 1 ? '' : 's'}
          </Button>
          <Link to="/train/review" className="block text-center text-xs font-semibold text-ink-400 underline hover:text-ink-200">
            Open Review mistakes
          </Link>
        </Panel>
      )}
      {report && game && (
        <Panel>
          <SummaryPanel report={report} game={game} onJump={goTo} />
        </Panel>
      )}
    </div>
  );

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
      <GameLayout board={board} side={side$} />
      <ShortcutHelp open={help.helpOpen} onClose={help.closeHelp} groups={SHORTCUTS} />
    </div>
  );
}
