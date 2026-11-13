import { Chess } from 'chess.js';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { uciToMove, validateLine } from '@knightfall/core';
import { db } from '../../../shared/db.ts';
import { confetti, sfx } from '../../../shared/fx/index.ts';
import { Button, Icons, PageHeader, Panel } from '../../../shared/ui.tsx';
import { FadeIn, Stepper, useToast } from '../bits.tsx';
import {
  DEFAULT_RATING,
  START_FEN,
  isSolverPly,
  lineError,
  parseFen,
  solverSide,
  toFen,
  validatePosition,
  type EditorPosition,
} from '../logic.ts';
import { saveCustom } from '../store.ts';
import { DetailsStep } from './DetailsStep.tsx';
import { SetupStep } from './SetupStep.tsx';
import { SolutionStep } from './SolutionStep.tsx';

function startPosition(): EditorPosition {
  const r = parseFen(START_FEN);
  if (!r.ok) throw new Error(r.error);
  return r.position;
}

/** Themes we can infer from the recorded line. */
function suggestThemes(fen: string, moves: string[], opponentFirst: boolean): string[] {
  try {
    const c = new Chess(fen);
    for (const m of moves) c.move(uciToMove(m));
    if (!c.isCheckmate()) return [];
    const n = moves.filter((_, i) => isSolverPly(i, opponentFirst)).length;
    return n <= 2 ? ['mate', `mateIn${n}`] : ['mate'];
  } catch {
    return [];
  }
}

type LoadState = 'loading' | 'ready' | 'missing';

/** Three-step puzzle editor: position → solution → details. Pass `id` to edit an existing puzzle. */
export function Editor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [load, setLoad] = useState<LoadState>(id ? 'loading' : 'ready');
  const [step, setStep] = useState(0);
  const [position, setPosition] = useState<EditorPosition>(startPosition);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [moves, setMoves] = useState<string[]>([]);
  const [solutionFen, setSolutionFen] = useState<string | null>(null);
  const [opponentFirst, setOpponentFirst] = useState(false);
  const [title, setTitle] = useState('');
  const [themes, setThemes] = useState<string[]>([]);
  const [themesTouched, setThemesTouched] = useState(false);
  const [rating, setRating] = useState(DEFAULT_RATING);
  const [saving, setSaving] = useState(false);

  // Load the puzzle being edited once (not live: edits must not be clobbered by DB updates).
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void db.customPuzzles.get(id).then((p) => {
      if (!alive) return;
      const parsed = p && parseFen(p.fen);
      if (!p || !parsed || !parsed.ok) {
        setLoad('missing');
        return;
      }
      setPosition(parsed.position);
      setSolutionFen(toFen(parsed.position));
      setMoves(p.moves);
      setOpponentFirst(p.opponentFirst);
      setOrientation(solverSide(p.fen, p.opponentFirst) === 'w' ? 'white' : 'black');
      setTitle(p.title ?? '');
      setThemes(p.themes);
      setThemesTouched(true);
      setRating(p.rating);
      setLoad('ready');
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const fen = toFen(position);
  const positionOk = useMemo(() => validatePosition(fen) === null, [fen]);
  const lineOk = useMemo(
    () => solutionFen === fen && validateLine(fen, moves) === null && lineError(moves, opponentFirst) === null,
    [solutionFen, fen, moves, opponentFirst],
  );
  const maxReachable = !positionOk ? 0 : !lineOk ? 1 : 2;

  const goTo = (target: number) => {
    if (target > maxReachable && !(target === 1 && positionOk)) return;
    if (target >= 1 && solutionFen !== fen) {
      // The position changed since the line was recorded: the old line no longer applies.
      if (moves.length) toast('Position changed — solution cleared', 'info');
      setMoves([]);
      setSolutionFen(fen);
      setOrientation(solverSide(fen, opponentFirst) === 'w' ? 'white' : 'black');
    }
    if (target === 2 && !themesTouched) {
      setThemes(suggestThemes(fen, moves, opponentFirst));
      setThemesTouched(true);
    }
    setStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (thenPlay: boolean) => {
    if (saving || !lineOk) return;
    setSaving(true);
    try {
      const saved = await saveCustom({ fen, moves, opponentFirst, title: title.trim(), themes, rating }, id);
      sfx.solved();
      confetti({ count: 70 });
      toast(id ? 'Changes saved' : 'Puzzle saved');
      navigate(thenPlay ? `/custom/play/${saved.id}` : '/custom', { state: { highlight: saved.id } });
    } catch (e) {
      setSaving(false);
      sfx.wrong();
      toast(`Could not save: ${(e as Error).message}`, 'bad');
    }
  };

  const header = (
    <PageHeader
      title={id ? 'Edit puzzle' : 'New puzzle'}
      subtitle={id ? title || 'Update the position, line or details' : 'Build a position, play the solution, give it a name'}
      icon={Icons.pencil('h-6 w-6')}
      right={
        <Link to="/custom" className="text-sm font-semibold text-ink-400 transition hover:text-ink-100">
          ← My puzzles
        </Link>
      }
    />
  );

  if (load === 'loading') {
    return (
      <>
        {header}
        <div className="p-10 text-center text-ink-400">Loading puzzle…</div>
      </>
    );
  }
  if (load === 'missing') {
    return (
      <>
        {header}
        <Panel className="mx-auto max-w-md space-y-4 text-center">
          <p className="text-lg font-bold">This puzzle doesn't exist anymore.</p>
          <p className="text-sm text-ink-400">It may have been deleted. You can start a fresh one instead.</p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => navigate('/custom')}>My puzzles</Button>
            <Button variant="primary" onClick={() => navigate('/custom/new')}>
              New puzzle
            </Button>
          </div>
        </Panel>
      </>
    );
  }

  const solverMoves = moves.filter((_, i) => isSolverPly(i, opponentFirst)).length;

  return (
    <>
      {header}
      <div className="mx-auto max-w-6xl">
        <Stepper step={step} maxReached={maxReachable} onStep={goTo} />
      </div>
      <FadeIn key={step}>
        {step === 0 && (
          <SetupStep position={position} setPosition={setPosition} orientation={orientation} setOrientation={setOrientation} onContinue={() => goTo(1)} />
        )}
        {step === 1 && (
          <SolutionStep
            startFen={fen}
            moves={moves}
            setMoves={setMoves}
            opponentFirst={opponentFirst}
            setOpponentFirst={setOpponentFirst}
            orientation={orientation}
            setOrientation={setOrientation}
            onBack={() => goTo(0)}
            onContinue={() => goTo(2)}
          />
        )}
        {step === 2 && (
          <DetailsStep
            fen={fen}
            moves={moves}
            opponentFirst={opponentFirst}
            orientation={orientation}
            solver={solverSide(fen, opponentFirst)}
            solverMoves={solverMoves}
            endsInMate={suggestThemes(fen, moves, opponentFirst).length > 0}
            title={title}
            setTitle={setTitle}
            themes={themes}
            setThemes={setThemes}
            rating={rating}
            setRating={setRating}
            isEdit={!!id}
            saving={saving}
            onBack={() => goTo(1)}
            onSave={(p) => void save(p)}
          />
        )}
      </FadeIn>
    </>
  );
}
