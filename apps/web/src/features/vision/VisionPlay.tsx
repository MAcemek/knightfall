import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sfx } from '../../shared/fx/index.ts';
import { Button, Icons, PageHeader, Panel, Pill } from '../../shared/ui.tsx';
import { saveRun } from './bestStore.ts';
import { VisionBoard, type SquareMark } from './VisionBoard.tsx';
import {
  accuracyPercent,
  clockText,
  DRILLS,
  isKnightMove,
  knightRoute,
  nameChoices,
  randomSquare,
  remainingMs,
  squareName,
  type KnightRoute,
  type VisionColor,
  type VisionDrill,
} from './visionLogic.ts';

type Phase = 'ready' | 'playing' | 'done';

interface Run {
  correct: number;
  misses: number;
  /** Knight routes finished in the fewest possible moves. */
  perfect: number;
  /** find: the square to tap. name: the lit square. */
  target: number;
  /** name: the four answers. */
  choices: number[];
  /** knight: the current route, where the knight stands and how many moves it has made on this route. */
  route: KnightRoute | null;
  knight: number;
  hops: number;
  /** knight: how the last route went, shown under the prompt. */
  note: string;
  marks: Partial<Record<number, SquareMark>>;
  /** name: the answer just picked, while its feedback shows. */
  picked: { sq: number; ok: boolean } | null;
  /** Input paused while feedback for a wrong answer shows. */
  locked: boolean;
}

const rng = Math.random;
const WRONG_PAUSE_MS = 750;
const RIGHT_FLASH_MS = 220;

function nextTarget(drill: VisionDrill, prev?: number): Pick<Run, 'target' | 'choices'> {
  const target = randomSquare(rng, prev);
  return { target, choices: drill === 'name' ? nameChoices(rng, target) : [] };
}

function nextRoute(prevFrom?: number): Pick<Run, 'route' | 'knight' | 'hops'> {
  const route = knightRoute(rng, 2, 4, prevFrom);
  return { route, knight: route.from, hops: 0 };
}

function freshRun(drill: VisionDrill): Run {
  return {
    correct: 0,
    misses: 0,
    perfect: 0,
    ...nextTarget(drill),
    ...(drill === 'knight' ? nextRoute() : { route: null, knight: -1, hops: 0 }),
    note: '',
    marks: {},
    picked: null,
    locked: false,
  };
}

/** One timed run of a vision drill: ready screen, the run itself, then the result. */
export function VisionPlay({ drill, color }: { drill: VisionDrill; color: VisionColor }) {
  const cfg = DRILLS[drill];
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('ready');
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [run, setRun] = useState<Run>(() => freshRun(drill));
  const [result, setResult] = useState<{ isNew: boolean; previous: number | null } | null>(null);
  // Feedback timers; a newer one replaces an older one so stale flashes never wipe fresh marks.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const later = (ms: number, fn: () => void) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const left = phase === 'playing' ? remainingMs(startedAt, now, cfg.durationMs) : phase === 'done' ? 0 : cfg.durationMs;
  const playing = phase === 'playing';

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [playing]);

  // Time up: save the run once.
  useEffect(() => {
    if (!playing || left > 0) return;
    clearTimeout(timer.current);
    setPhase('done');
    setRun((r) => ({ ...r, marks: {}, picked: null, locked: false }));
    sfx.solved();
    void saveRun(drill, color, run.correct).then(setResult);
  }, [playing, left, drill, color, run.correct]);

  const start = () => {
    clearTimeout(timer.current);
    setRun(freshRun(drill));
    setResult(null);
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    setPhase('playing');
    sfx.go();
  };

  /* Find the square: tap the named square. */
  const tapFind = (sq: number) => {
    if (run.locked) return;
    if (sq === run.target) {
      sfx.correct();
      setRun((r) => ({ ...r, correct: r.correct + 1, ...nextTarget(drill, r.target), marks: { [sq]: 'good' } }));
      later(RIGHT_FLASH_MS, () => setRun((r) => ({ ...r, marks: {} })));
    } else {
      sfx.wrong();
      setRun((r) => ({ ...r, misses: r.misses + 1, locked: true, marks: { [sq]: 'bad', [r.target]: 'reveal' } }));
      later(WRONG_PAUSE_MS, () => setRun((r) => ({ ...r, ...nextTarget(drill, r.target), marks: {}, locked: false })));
    }
  };

  /* Name the square: pick the lit square's name. */
  const answer = (sq: number) => {
    if (!playing || run.locked) return;
    const ok = sq === run.target;
    if (ok) sfx.correct();
    else sfx.wrong();
    setRun((r) => ({ ...r, correct: r.correct + (ok ? 1 : 0), misses: r.misses + (ok ? 0 : 1), picked: { sq, ok }, locked: true }));
    later(ok ? RIGHT_FLASH_MS : WRONG_PAUSE_MS, () => setRun((r) => ({ ...r, ...nextTarget(drill, r.target), picked: null, locked: false })));
  };

  /* Knight routes: hop to the flag. */
  const tapKnight = (sq: number) => {
    const route = run.route;
    if (run.locked || !route || sq === run.knight) return;
    if (!isKnightMove(run.knight, sq)) {
      sfx.wrong();
      setRun((r) => ({ ...r, misses: r.misses + 1, marks: { [sq]: 'bad' } }));
      later(300, () => setRun((r) => ({ ...r, marks: {} })));
      return;
    }
    const hops = run.hops + 1;
    if (sq !== route.to) {
      sfx.move();
      setRun((r) => ({ ...r, knight: sq, hops, marks: {} }));
      return;
    }
    const perfect = hops === route.min;
    sfx.correct();
    setRun((r) => ({
      ...r,
      knight: sq,
      hops,
      correct: r.correct + 1,
      perfect: r.perfect + (perfect ? 1 : 0),
      note: perfect ? `Perfect: ${hops} ${hops === 1 ? 'move' : 'moves'}` : `${hops} moves. It can be done in ${route.min}`,
      marks: { [sq]: 'good' },
      locked: true,
    }));
    later(350, () => setRun((r) => ({ ...r, ...nextRoute(route.from), marks: {}, locked: false })));
  };

  // Keys 1 to 4 pick an answer in Name the square.
  useEffect(() => {
    if (drill !== 'name' || !playing) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && run.choices[n - 1] !== undefined) answer(run.choices[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onTap = drill === 'find' ? tapFind : drill === 'knight' ? tapKnight : () => undefined;
  const marks: Partial<Record<number, SquareMark>> = drill === 'name' && playing ? { ...run.marks, [run.target]: 'lit' } : run.marks;
  const accuracy = accuracyPercent(run.correct, run.misses);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        compact
        title={cfg.title}
        subtitle={`Board seen from ${color === 'w' ? 'White' : 'Black'}`}
        icon={Icons.eye('h-6 w-6')}
        right={
          <Link to="/train/vision" className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-400 transition hover:text-ink-100">
            ← Drills
          </Link>
        }
      />

      {/* Clock and score */}
      <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl bg-ink-850 px-4 py-2">
        <div className={`flex items-center gap-2 font-mono text-2xl font-black tabular ${playing && left <= 5000 ? 'text-bad-400' : 'text-ink-100'}`}>
          {Icons.clock('h-5 w-5 text-ink-400')}
          {clockText(left)}
        </div>
        <div className="flex items-center gap-3 font-mono font-bold tabular">
          <span className="text-good-400" aria-label="Correct">
            ✓ {run.correct}
          </span>
          <span className="text-bad-400" aria-label="Misses">
            ✗ {run.misses}
          </span>
        </div>
      </div>

      {phase === 'done' ? (
        <Panel className="animate-pop text-center">
          <div className="text-sm font-bold uppercase tracking-wider text-ink-400">Score</div>
          <div className={`font-mono text-6xl font-black tabular ${result?.isNew ? 'text-ember-400' : 'text-ink-100'}`}>{run.correct}</div>
          <div className="mt-1 min-h-6 font-semibold">
            {result?.isNew ? (
              <span className="text-ember-400">{result.previous === null ? 'First score set!' : `New best! Previous ${result.previous}`}</span>
            ) : result ? (
              <span className="text-ink-400">Best {result.previous ?? 0}</span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {accuracy !== null && <Pill>{accuracy}% accurate</Pill>}
            {drill === 'knight' && run.correct > 0 && (
              <Pill>
                {run.perfect} of {run.correct} in the fewest moves
              </Pill>
            )}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="primary" className="h-12" onClick={start}>
              {Icons.retry('h-5 w-5')} Play again
            </Button>
            <Button variant="secondary" className="h-12" onClick={() => navigate('/train/vision')}>
              Other drills
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          {/* Prompt (fixed height so the board does not jump) */}
          <div className="mb-2 flex min-h-14 flex-col items-center justify-center text-center" aria-live="polite">
            {phase === 'ready' ? (
              <p className="px-2 text-sm text-ink-300">{cfg.how}</p>
            ) : drill === 'find' ? (
              <div className="font-mono text-5xl font-black leading-none text-ember-400">{squareName(run.target)}</div>
            ) : drill === 'name' ? (
              <div className="text-lg font-bold text-ink-100">Which square is lit?</div>
            ) : (
              <>
                <div className="text-lg font-bold text-ink-100">
                  Reach the flag in {run.route?.min ?? 0} {run.route?.min === 1 ? 'move' : 'moves'}
                </div>
                <div className={`min-h-5 text-sm font-semibold ${run.note.startsWith('Perfect') ? 'text-good-400' : 'text-ink-400'}`}>
                  {/* How the last route went, until the first move of the next one. */}
                  {(run.locked || run.hops === 0) && run.note ? run.note : `Moves so far: ${run.hops}`}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <VisionBoard
              orientation={color}
              marks={marks}
              knight={drill === 'knight' && playing ? run.knight : undefined}
              flag={drill === 'knight' && playing ? run.route?.to : undefined}
              disabled={!playing || drill === 'name'}
              withAnswers={drill === 'name'}
              onTap={onTap}
            />
            {phase === 'ready' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button variant="primary" size="lg" className="text-xl" onClick={start}>
                  {Icons.bolt('h-6 w-6')} Start
                </Button>
              </div>
            )}
          </div>

          {drill === 'name' && (
            <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Answers">
              {(playing ? run.choices : [0, 1, 2, 3]).map((sq, i) => {
                const fb = run.picked;
                const tone = !fb ? '' : sq === run.target ? '!bg-good-500 !text-ink-950' : fb.sq === sq ? '!bg-bad-500 !text-white' : 'opacity-60';
                return (
                  <Button key={`${i}-${sq}`} variant="secondary" disabled={!playing} className={`h-12 font-mono text-2xl ${tone}`} onClick={() => answer(sq)}>
                    {playing ? squareName(sq) : '·'}
                  </Button>
                );
              })}
            </div>
          )}

          {playing && (
            <div className="mt-2 flex justify-center">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearTimeout(timer.current);
                  setPhase('ready');
                  setRun(freshRun(drill));
                }}
              >
                Stop
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
