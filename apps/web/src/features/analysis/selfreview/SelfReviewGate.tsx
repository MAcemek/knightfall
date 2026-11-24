import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { ParsedGame } from '@knightfall/core';
import { Board } from '../../../shared/Board/index.ts';
import type { SelfReviewReason, StoredGame } from '../../../shared/db.ts';
import { sfx } from '../../../shared/fx/index.ts';
import { toast } from '../../../shared/toast.tsx';
import { Button, GameLayout, Icons, Panel } from '../../../shared/ui.tsx';
import { useHotkeys } from '../../puzzles/useHotkeys.ts';
import { MoveList, ReviewHeader } from '../review/parts.tsx';
import { moveLabel, provisionalMoves, soundKind } from '../review/reviewExtras.ts';
import { NavButton } from '../review/ReviewView.tsx';
import {
  buildSkipped, buildSubmitted, canMark, cleanLesson, MAX_LESSON, REASONS, submitProblem, type Choice,
} from './selfReviewLogic.ts';
import { saveSelfReview } from './selfReviewStore.ts';

/**
 * The engine-off review: the game on a plain board (no evaluation, no classes), the player marks the move where
 * it turned, picks a reason and writes one lesson. Nothing here starts an analysis session or an engine worker.
 */
export function SelfReviewGate({ game, parsed, side, onDone }: { game: StoredGame; parsed: ParsedGame; side: 'w' | 'b'; onDone: () => void }) {
  const moves = useMemo(() => provisionalMoves(parsed), [parsed]);
  const N = moves.length;
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState<SelfReviewReason | null>(null);
  const [lesson, setLesson] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const ids = useId();

  const orientation: 'white' | 'black' = (side === 'b') !== flipped ? 'black' : 'white';

  const plyRef = useRef(ply);
  plyRef.current = ply;
  const goTo = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(N, index));
      if (next !== plyRef.current && next > 0) sfx[soundKind(moves[next - 1].san)]();
      setPly(next);
    },
    [N, moves],
  );

  useHotkeys({
    arrowleft: () => goTo(ply - 1),
    arrowup: () => goTo(ply - 1),
    arrowright: () => goTo(ply + 1),
    arrowdown: () => goTo(ply + 1),
    home: () => goTo(0),
    end: () => goTo(N),
    f: () => setFlipped((f) => !f),
  });

  const shown = ply > 0 ? moves[ply - 1] : null;
  const lastMove = shown ? ([shown.uci.slice(0, 2), shown.uci.slice(2, 4)] as [string, string]) : null;
  const markable = ply > 0 && canMark(moves, ply - 1, side);
  const markedHere = choice?.kind === 'move' && choice.ply === ply - 1;
  const markedMove = choice?.kind === 'move' ? moves[choice.ply] : null;

  const hint = markedHere
    ? 'Marked. Press it again to clear it.'
    : ply === 0
      ? 'Step to one of your moves first.'
      : markable
        ? 'Mark this move if the game turned here for you.'
        : 'That is your opponent’s move. Pick one of yours.';

  const markHere = () => {
    if (!markable) return;
    setChoice(markedHere ? null : { kind: 'move', ply: ply - 1 });
  };
  const markNone = () => {
    if (choice?.kind === 'none') {
      setChoice(null);
      return;
    }
    setChoice({ kind: 'none' });
    setReason(null);
  };

  const problem = submitProblem(choice, reason, lesson);

  const save = async (row: ReturnType<typeof buildSkipped>) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await saveSelfReview(row);
      onDone();
    } catch {
      sending.current = false;
      setBusy(false);
      toast({ title: 'Could not save your review', body: 'Please try again.', icon: 'x', tone: 'ember' });
    }
  };
  const submit = () => {
    if (problem !== null) return;
    void save(buildSubmitted({ gameKey: game.key, side, choice, reason, lesson, at: Date.now() }));
  };
  const skip = () => void save(buildSkipped({ gameKey: game.key, side, at: Date.now() }));

  const yourPoint = choice === null ? 'Not chosen yet' : choice.kind === 'none' ? 'None' : markedMove ? moveLabel(markedMove) : 'None';

  const board = (
    <div>
      <div className="max-lg:mx-auto max-lg:max-w-[max(13rem,calc(100dvh-24rem))]">
        <Board fen={parsed.fens[ply]} orientation={orientation} lastMove={lastMove} interactive={false} annotationKey={game.key} positionKey={game.key} />
      </div>
      <div className="mt-2 flex items-center gap-2" role="group" aria-label="Move navigation">
        <NavButton label="First move" onClick={() => goTo(0)} disabled={ply === 0}>
          <path d="M6 5v14M19 5l-9 7 9 7z" />
        </NavButton>
        <NavButton label="Previous move" onClick={() => goTo(ply - 1)} disabled={ply === 0}>
          <path d="M17 5l-9 7 9 7z" />
        </NavButton>
        <NavButton label="Next move" onClick={() => goTo(ply + 1)} disabled={ply >= N}>
          <path d="M7 5l9 7-9 7z" />
        </NavButton>
        <NavButton label="Last move" onClick={() => goTo(N)} disabled={ply >= N}>
          <path d="M18 5v14M5 5l9 7-9 7z" />
        </NavButton>
        <Button variant="ghost" className="shrink-0 max-lg:min-h-12" onClick={() => setFlipped((f) => !f)} aria-label="Flip board (F)">
          {Icons.flip('h-4 w-4')} Flip
        </Button>
      </div>
      <div className="mt-2 space-y-1.5 lg:hidden">
        <div className="flex min-h-5 items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-ink-300">{shown ? `Shown: ${moveLabel(shown)}` : 'Shown: the start'}</span>
          <span className="min-w-0 shrink-0 truncate font-mono font-bold text-ink-100">{yourPoint === 'Not chosen yet' ? '' : yourPoint}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            disabled={!markable}
            aria-pressed={markedHere}
            aria-label="This is the point of no return"
            aria-describedby={`${ids}-hint`}
            className={`px-2 text-sm ${markedHere ? 'ring-2 ring-ember-400' : ''}`}
            onClick={markHere}
          >
            Turned here
          </Button>
          <Button variant="secondary" aria-pressed={choice?.kind === 'none'} className={`px-2 text-sm ${choice?.kind === 'none' ? 'ring-2 ring-ember-400' : ''}`} onClick={markNone}>
            There was none
          </Button>
        </div>
      </div>
    </div>
  );

  const panel = (
    <Panel className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold">Look at it yourself first</h2>
        <p className="mt-1 text-sm text-ink-400">
          You played {side === 'w' ? 'White' : 'Black'}. Step through the game and mark the move where it turned for you. Stockfish starts after you submit.
        </p>
      </div>

      <MoveList moves={moves} classified={false} current={ply} onSelect={goTo} />

      <section className="space-y-2" aria-label="Point of no return">
        <p className="min-h-5 text-sm text-ink-300" aria-live="polite">
          {shown ? `Shown: ${moveLabel(shown)}` : 'Shown: the starting position'}
        </p>
        <div className="flex flex-col gap-2 max-lg:hidden">
          <Button variant="secondary" disabled={!markable} aria-pressed={markedHere} aria-describedby={`${ids}-hint`} className={`w-full ${markedHere ? 'ring-2 ring-ember-400' : ''}`} onClick={markHere}>
            This is the point of no return
          </Button>
          <Button variant="secondary" aria-pressed={choice?.kind === 'none'} className={`w-full ${choice?.kind === 'none' ? 'ring-2 ring-ember-400' : ''}`} onClick={markNone}>
            There was none
          </Button>
        </div>
        <p id={`${ids}-hint`} className="min-h-8 text-xs text-ink-400">
          {hint}
        </p>
        <p className="text-sm text-ink-200" aria-live="polite">
          Your point: <span className="font-mono font-bold text-ink-100">{yourPoint}</span>
        </p>
      </section>

      {choice?.kind === 'move' && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-ink-100">Why did it turn?</legend>
          <div role="radiogroup" aria-label="Reason" className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={reason === r.id}
                onClick={() => {
                  sfx.click();
                  setReason(r.id);
                }}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors max-lg:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${reason === r.id ? 'border-ember-400 bg-ink-700 text-ember-400' : 'border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-500 hover:text-ink-100'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`${ids}-lesson`} className="text-sm font-bold text-ink-100">
          One lesson from this game
        </label>
        <input
          id={`${ids}-lesson`}
          type="text"
          value={lesson}
          maxLength={MAX_LESSON}
          autoComplete="off"
          onChange={(e) => setLesson(e.target.value)}
          className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-3 font-semibold text-ink-100 outline-none focus:border-ember-400"
        />
        <p className="text-right font-mono text-xs text-ink-500" aria-hidden>
          {cleanLesson(lesson).length}/{MAX_LESSON}
        </p>
      </div>

      <div className="space-y-2">
        <p className="min-h-5 text-xs text-ink-400" aria-live="polite">
          {problem ?? ''}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="good" disabled={problem !== null || busy} onClick={submit}>
            Submit and run the engine
          </Button>
          <button
            type="button"
            disabled={busy}
            onClick={skip}
            className="min-h-11 rounded-lg px-2 text-sm font-bold text-ink-300 underline underline-offset-4 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      </div>
    </Panel>
  );

  return (
    <div className="w-full">
      <ReviewHeader game={game} report={null} />
      <GameLayout board={board} side={panel} wideSide />
    </div>
  );
}
