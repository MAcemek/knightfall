import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Board, type BoardArrow, type BoardMark } from '../../shared/Board/index.ts';
import { db, type OpeningLineProgress } from '../../shared/db.ts';
import { sfx } from '../../shared/fx/sound.ts';
import { playMoveSound } from '../../shared/PuzzlePlayer/usePuzzleRunner.ts';
import { formatInterval } from '../../shared/progress/index.ts';
import { Button, EmptyState, GameLayout, Icons, PageHeader, Panel, Pill } from '../../shared/ui.tsx';
import {
  gradeLine, isUserPly, judgeBookMove, pickNextLine, progressId, progressMap,
  type NextLine, type OpeningFamily, type OpeningLine, type Side,
} from './openingLogic.ts';
import { useOpeningData } from './useOpeningData.ts';

/** Pause before the opponent's book reply, so the move is easy to follow. */
const REPLY_MS = 550;

/** /train/openings/drill?f=<family>&c=<w|b> */
export function OpeningDrill() {
  const [params] = useSearchParams();
  const state = useOpeningData();
  const name = params.get('f') ?? '';
  const c = params.get('c');
  if (c !== 'w' && c !== 'b') return <Navigate to="/train/openings" replace />;
  if (state.status === 'loading') return <p className="text-sm text-ink-400">Loading openings…</p>;
  const family = state.status === 'ready' ? state.data.families.find((f) => f.name === name) : undefined;
  if (!family) return <Navigate to="/train/openings" replace />;
  return <DrillSession key={`${name}:${c}`} family={family} color={c} />;
}

interface Session {
  progress: Map<string, OpeningLineProgress>;
  /** Progress ids already drilled in this visit. */
  done: Set<string>;
  current: NextLine | null;
}

function DrillSession({ family, color }: { family: OpeningFamily; color: Side }) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let live = true;
    void db.openingLines
      .where('family')
      .equals(family.name)
      .toArray()
      .then((rows) => {
        if (!live) return;
        const progress = progressMap(rows);
        setSession({ progress, done: new Set(), current: pickNextLine(family.lines, progress, color, Date.now()) });
      });
    return () => {
      live = false;
    };
  }, [family, color]);

  const sideName = color === 'w' ? 'White' : 'Black';
  const header = <PageHeader title={family.name} subtitle={`Playing ${sideName}`} icon={Icons.layers('h-6 w-6')} compact />;

  if (!session) return <div className="mx-auto max-w-6xl">{header}</div>;

  if (!session.current) {
    const waiting = [...session.progress.values()].filter((p) => p.family === family.name && p.color === color && p.due > Date.now());
    const nextDue = waiting.length ? Math.min(...waiting.map((p) => p.due)) : null;
    return (
      <div className="mx-auto max-w-6xl">
        {header}
        <EmptyState
          icon={Icons.check('h-6 w-6')}
          title={session.done.size ? 'Session complete' : 'All caught up'}
          action={
            <Link to="/train/openings" className="font-bold text-ember-400">
              Back to openings
            </Link>
          }
        >
          {session.done.size ? `You drilled ${session.done.size} line${session.done.size === 1 ? '' : 's'}. ` : ''}
          {nextDue !== null ? `The next line is due in ${formatInterval(Math.max(60_000, nextDue - Date.now()))}.` : 'Nothing is waiting in this opening.'}
        </EmptyState>
      </div>
    );
  }

  const current = session.current;
  return (
    <div className="mx-auto max-w-6xl">
      {header}
      <LineDrill
        key={current.line.id}
        next={current}
        family={family.name}
        color={color}
        onSaved={(row) => {
          setSession((s) => (s ? { ...s, progress: new Map(s.progress).set(row.id, row) } : s));
        }}
        onNext={() => {
          setSession((s) => {
            if (!s) return s;
            const done = new Set(s.done).add(progressId(current.line.id, color));
            return { ...s, done, current: pickNextLine(family.lines, s.progress, color, Date.now(), done) };
          });
        }}
      />
    </div>
  );
}

/** Position after the first `ply` moves of the line. */
function replay(line: OpeningLine, ply: number): { fen: string; lastMove: [string, string] | null } {
  const chess = new Chess();
  for (let i = 0; i < ply; i++) chess.move({ from: line.uci[i].slice(0, 2), to: line.uci[i].slice(2, 4), promotion: line.uci[i].slice(4) || undefined });
  const last = ply > 0 ? line.uci[ply - 1] : null;
  return { fen: chess.fen(), lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : null };
}

interface Wrong {
  from: string;
  to: string;
  /** Changes on every wrong attempt so the mark animation replays. */
  n: number;
}

function LineDrill({ next, family, color, onSaved, onNext }: {
  next: NextLine;
  family: string;
  color: Side;
  onSaved: (row: OpeningLineProgress) => void;
  onNext: () => void;
}) {
  const { line } = next;
  const learn = next.progress === null;
  const [ply, setPly] = useState(0);
  const [slips, setSlips] = useState(0);
  const [hinted, setHinted] = useState(false);
  const [wrong, setWrong] = useState<Wrong | null>(null);
  const [saved, setSaved] = useState<OpeningLineProgress | null>(null);
  const finished = ply >= line.uci.length;
  const userTurn = !finished && isUserPly(ply, color);

  const { fen, lastMove } = useMemo(() => replay(line, ply), [line, ply]);

  // The opponent's book moves play themselves.
  useEffect(() => {
    if (finished || userTurn) return;
    const t = window.setTimeout(() => {
      const uci = line.uci[ply];
      const chess = new Chess(replay(line, ply).fen);
      playMoveSound(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }));
      setPly(ply + 1);
    }, REPLY_MS);
    return () => window.clearTimeout(t);
  }, [line, ply, finished, userTurn]);

  // Grade and store the run once the line is over.
  const grading = useRef(false);
  useEffect(() => {
    if (!finished || grading.current) return;
    grading.current = true;
    const row = gradeLine(next.progress, { id: progressId(line.id, color), family, color }, slips === 0 && (learn || !hinted), Date.now());
    sfx.solved();
    void db.openingLines.put(row).then(() => {
      onSaved(row);
      setSaved(row);
    });
  }, [finished, next.progress, line.id, family, color, slips, learn, hinted, onSaved]);

  function onMove(uci: string) {
    if (!userTurn) return;
    if (!judgeBookMove(line, ply, uci)) {
      setSlips((n) => n + 1);
      setWrong({ from: uci.slice(0, 2), to: uci.slice(2, 4), n: slips + 1 });
      sfx.wrong();
      return;
    }
    const chess = new Chess(fen);
    playMoveSound(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }));
    setWrong(null);
    setPly(ply + 1);
  }

  const expected = userTurn ? line.uci[ply] : null;
  const showMove = expected !== null && (learn || hinted || wrong !== null);
  const arrows: BoardArrow[] = showMove ? [{ from: expected.slice(0, 2), to: expected.slice(2, 4), color: 'hint' }] : [];
  const mark: BoardMark | null = wrong ? { square: wrong.to, kind: 'wrong', key: wrong.n } : null;

  let status = 'Playing the book reply…';
  if (finished) status = 'Line complete.';
  else if (userTurn && wrong) status = `Not the book move. Play the one shown on the board.`;
  else if (userTurn && learn) status = 'New line. Play the move shown by the arrow.';
  else if (userTurn) status = 'Your move. Play the book move.';

  return (
    <GameLayout
      board={
        <Board
          fen={fen}
          orientation={color === 'w' ? 'white' : 'black'}
          interactive={userTurn}
          movableColor={color}
          lastMove={lastMove}
          mark={mark}
          arrows={arrows}
          onMove={onMove}
          positionKey={line.id}
          annotationKey={line.id}
        />
      }
      side={
        <Panel className="animate-rise">
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Pill className={learn ? 'bg-ember-500/15 text-ember-400' : ''}>{learn ? 'Learn' : next.kind === 'due' ? 'Review' : 'Test'}</Pill>
            <Pill>{line.eco}</Pill>
            <Pill>
              Move {Math.min(Math.floor(ply / 2) + 1, Math.ceil(line.uci.length / 2))} of {Math.ceil(line.uci.length / 2)}
            </Pill>
          </div>
          <p className="min-h-6 font-semibold" role="status">
            {status}
          </p>
          {wrong && !finished && <p className="mt-1 text-sm text-bad-400">That is a miss. The line comes back sooner.</p>}

          {finished && (
            <div className="mt-3 animate-rise">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{line.eco}</div>
              <div className="text-lg font-extrabold">{line.name}</div>
              <p className="mt-2 text-sm text-ink-300">
                {slips === 0 && (learn || !hinted) ? 'Clean run.' : slips ? `${slips} slip${slips === 1 ? '' : 's'}.` : 'You used a hint.'}
                {saved ? ` Next review in ${formatInterval(Math.max(60_000, saved.due - Date.now()))}.` : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={onNext} disabled={!saved}>
                  {Icons.next('h-4 w-4')} Next line
                </Button>
                <Link to="/train/openings" className="inline-flex h-11 items-center px-3 font-bold text-ink-300 hover:text-ink-100">
                  Done
                </Link>
              </div>
            </div>
          )}

          {!finished && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={!userTurn || learn || hinted} onClick={() => setHinted(true)}>
                {Icons.bulb('h-4 w-4')} Show move
              </Button>
              <Link to="/train/openings" className="inline-flex h-11 items-center px-3 text-sm font-bold text-ink-400 hover:text-ink-100 lg:h-9">
                Stop
              </Link>
            </div>
          )}
        </Panel>
      }
    />
  );
}
