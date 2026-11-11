import { Chess, type Square } from 'chess.js';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motionOff, motionScale, useSettings } from '../settings.ts';
import {
  FILES, isLightSquare, parseFenPieces, pieceUrl, premoveDests, squareToXY, trackPieces, xyToSquare,
  type PieceCode, type TrackedPiece,
} from './pieces.ts';

export type MarkKind = 'correct' | 'wrong' | 'mate' | 'hint' | 'best';

export interface BoardMark {
  square: string;
  kind: MarkKind;
  /** Change to replay the feedback animation on the same square. */
  key?: string | number;
}

export type ArrowColor = 'green' | 'red' | 'blue' | 'yellow' | 'hint';

export interface BoardArrow {
  from: string;
  to: string;
  color?: ArrowColor;
}

export interface BoardProps {
  fen: string;
  orientation?: 'white' | 'black';
  /** Whether the user may move pieces of `movableColor` (defaults to side to move). */
  interactive?: boolean;
  movableColor?: 'w' | 'b';
  lastMove?: [string, string] | null;
  /** Feedback on a square: a colour wash plus an expanding ring. Deliberately no icon badge. */
  mark?: BoardMark | null;
  /** Squares to highlight strongly (e.g. hint: the piece to move, and where it goes). */
  pulse?: string[];
  /** Extra square tints, e.g. editor selections. */
  tints?: Record<string, string>;
  /** Arrows supplied by the app (e.g. the hint arrow). User-drawn arrows are handled internally. */
  arrows?: BoardArrow[];
  /** Called with a legal UCI move (promotion included). */
  onMove?: (uci: string) => void;
  /**
   * Premoves: when provided and it is NOT the user's turn, the user can queue a move for `movableColor`
   * (UCI, auto-queen) or clear it (null). The caller plays it when the turn comes.
   */
  onPremove?: (uci: string | null) => void;
  /** The currently queued premove, shown as a highlight. */
  premove?: [string, string] | null;
  /** Free mode (editor): any piece to any square, no legality. Called with from/to. */
  freeMove?: (from: string, to: string) => void;
  /** Free mode only: a piece from `from` was dragged and released outside the board (editor: remove it). */
  onDropOff?: (from: string) => void;
  /** Called on clicking a square (editor painting). Return true to consume the click. */
  onSquareClick?: (sq: string) => boolean | void;
  /** Change to clear user arrows/highlights (e.g. a new puzzle id). */
  annotationKey?: string | number;
  /**
   * Change together with `fen` when the position is replaced wholesale (a new puzzle). The pieces are then
   * dealt fresh instead of sliding in from the previous position, and no capture effect plays.
   */
  positionKey?: string | number;
  /** Increment to shake the board. */
  shakeKey?: number;
  /** Increment to play a one-shot light sweep across the board (puzzle solved). */
  sweepKey?: number;
  /** Rank/file labels. Leave undefined to follow the user's setting. */
  showCoords?: boolean;
  className?: string;
  children?: ReactNode;
}

const PROMO: ('q' | 'r' | 'b' | 'n')[] = ['q', 'n', 'r', 'b'];

/** Feedback colours per mark kind, as "r g b" triplets. */
const MARK_RGB: Record<MarkKind, string> = {
  correct: '47 207 111',
  best: '255 180 84',
  mate: '255 154 31',
  wrong: '240 72 72',
  hint: '108 196 255',
};

const ARROW_RGB: Record<ArrowColor, string> = {
  green: '21 160 72',
  red: '226 64 52',
  blue: '40 120 230',
  yellow: '240 175 20',
  hint: '255 154 31',
};

const PREMOVE_TINT = 'rgb(140 110 230 / 0.55)';

/** Arrow / highlight colour from modifier keys. */
function colorFromEvent(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): ArrowColor {
  if (e.shiftKey && (e.ctrlKey || e.metaKey)) return 'yellow';
  if (e.shiftKey) return 'red';
  if (e.ctrlKey || e.metaKey) return 'blue';
  if (e.altKey) return 'yellow';
  return 'green';
}

interface Ghost {
  id: number;
  sq: string;
  code: PieceCode;
}

interface Tracked {
  fen: string;
  key: string | number | undefined;
  pieces: TrackedPiece[];
  /** A piece that was just captured: rendered for one short fade-out under the capturing piece. */
  ghost: Ghost | null;
  /** Ids of the piece(s) that just changed square (1, or 2 when castling). */
  landed: number[];
  /** The whole position was just dealt (first render or a new positionKey). */
  fresh: boolean;
}

const NO_LANDED: number[] = [];

function dealTracked(fen: string, key: string | number | undefined): Tracked {
  return { fen, key, pieces: trackPieces([], parseFenPieces(fen)), ghost: null, landed: NO_LANDED, fresh: true };
}

/** Position after a fen/positionKey change. Pure. */
function advanceTracked(prev: Tracked, fen: string, key: string | number | undefined, effects: boolean): Tracked {
  if (key !== prev.key) return dealTracked(fen, key);
  const pieces = trackPieces(prev.pieces, parseFenPieces(fen));
  const ids = new Set(pieces.map((p) => p.id));
  const removed = prev.pieces.filter((p) => !ids.has(p.id));
  const prevSq = new Map(prev.pieces.map((p) => [p.id, p.sq]));
  const moved = pieces.filter((p) => prevSq.has(p.id) && prevSq.get(p.id) !== p.sq).map((p) => p.id);
  // One move = one piece changed square (two when castling). Anything else is a position swap: no effects.
  const single = moved.length === 1 || moved.length === 2;
  const captured = effects && single && removed.length === 1 && prev.pieces.length - pieces.length === 1 ? removed[0] : null;
  return {
    fen,
    key,
    pieces,
    ghost: captured ? { id: captured.id, sq: captured.sq, code: captured.code } : null,
    landed: single ? moved : NO_LANDED,
    fresh: false,
  };
}

const dragTransform = (x: number, y: number) => `translate(${(x - 0.5) * 100}%, ${(y - 0.5) * 100}%) scale(1.08)`;

/**
 * Knightfall chessboard: click-to-move + drag-and-drop, legal-move dots, sliding pieces,
 * premoves, right-click arrows & square highlights, last-move & check highlights,
 * promotion picker, feedback ripples, capture fade, landing settle, solved sweep and shake.
 *
 * Every effect is an overlay: none of them delays input or a position change.
 */
export function Board({
  fen,
  orientation = 'white',
  interactive = false,
  movableColor,
  lastMove,
  mark,
  pulse,
  tints,
  arrows,
  onMove,
  onPremove,
  premove,
  freeMove,
  onDropOff,
  onSquareClick,
  annotationKey,
  positionKey,
  shakeKey = 0,
  sweepKey = 0,
  showCoords,
  className = '',
  children,
}: BoardProps) {
  const settings = useSettings();
  const coords = showCoords ?? settings.showCoords;
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  /**
   * Drag state holds only what changes rarely. The pointer position lives in `dragPos` and is written
   * straight to the dragged piece's style, so a drag costs zero React renders per pointermove.
   */
  const [drag, setDrag] = useState<{ id: number; from: Square; moved: boolean } | null>(null);
  const dragPos = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const pieceEls = useRef(new Map<number, HTMLDivElement>());
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [shaking, setShaking] = useState(false);
  /** Piece dropped by drag: it lands instantly instead of sliding from its origin. */
  const [snapId, setSnapId] = useState<number | null>(null);
  const [sweep, setSweep] = useState(0);
  const mountSweep = useRef(sweepKey);

  // User annotations (right mouse button).
  const [userArrows, setUserArrows] = useState<BoardArrow[]>([]);
  const [userMarks, setUserMarks] = useState<Record<string, ArrowColor>>({});
  const [drawing, setDrawing] = useState<{ from: string; to: string | null; color: ArrowColor } | null>(null);

  // Track pieces synchronously during render (no one-frame lag) so moves feel instant.
  const [tracked, setTracked] = useState<Tracked>(() => dealTracked(fen, positionKey));
  let cur = tracked;
  if (tracked.fen !== fen || tracked.key !== positionKey) {
    cur = advanceTracked(tracked, fen, positionKey, !motionOff());
    setTracked(cur);
    setSelected(null);
    setPromo(null);
  }
  const pieces = cur.pieces;

  // Landing settle: a tiny squash on the piece(s) that just moved. Web Animations API on the <img>,
  // so it never touches the wrapper's transform (the slide) and never delays anything.
  useLayoutEffect(() => {
    if (!tracked.landed.length || motionOff()) return;
    const duration = 240 * motionScale();
    for (const id of tracked.landed) {
      const img = pieceEls.current.get(id)?.firstElementChild;
      img?.animate?.([{ transform: 'scale(1.09)' }, { transform: 'scale(0.96)', offset: 0.7 }, { transform: 'scale(1)' }], { duration, easing: 'ease-out' });
    }
  }, [tracked.landed]);

  const clearGhost = useCallback(() => setTracked((t) => (t.ghost ? { ...t, ghost: null } : t)), []);

  useEffect(() => {
    if (snapId === null) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setSnapId(null)));
    return () => cancelAnimationFrame(raf);
  }, [fen, snapId]);

  useEffect(() => {
    setUserArrows([]);
    setUserMarks({});
  }, [annotationKey]);

  useEffect(() => {
    if (!shakeKey) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 450);
    return () => clearTimeout(t);
  }, [shakeKey]);

  useEffect(() => {
    if (sweepKey !== mountSweep.current) setSweep(sweepKey);
  }, [sweepKey]);

  const chess = useMemo(() => {
    try {
      return new Chess(fen, { skipValidation: true });
    } catch {
      return null;
    }
  }, [fen]);

  const turn = (fen.split(' ')[1] as 'w' | 'b') ?? 'w';
  const color = movableColor ?? turn;
  const canMove = interactive && !!chess && color === turn;
  const premoveMode = !canMove && !!onPremove && !freeMove;

  const legal = useMemo(() => {
    const map = new Map<string, { to: string; promotion: boolean; capture: boolean }[]>();
    if (!canMove || !chess) return map;
    for (const m of chess.moves({ verbose: true })) {
      if (m.color !== color) continue;
      const list = map.get(m.from) ?? [];
      if (!list.some((x) => x.to === m.to)) list.push({ to: m.to, promotion: !!m.promotion, capture: m.isCapture() || m.isEnPassant() });
      map.set(m.from, list);
    }
    return map;
  }, [chess, canMove, color]);

  const checkSquare = useMemo(() => {
    if (!chess || !chess.inCheck()) return null;
    const b = chess.board();
    for (const row of b) for (const p of row) if (p && p.type === 'k' && p.color === turn) return p.square;
    return null;
  }, [chess, turn]);

  const pieceAt = useCallback((sq: string) => pieces.find((p) => p.sq === sq), [pieces]);

  const targetsFor = useCallback(
    (from: string): { to: string; promotion: boolean; capture: boolean }[] => {
      if (canMove) return legal.get(from) ?? [];
      if (premoveMode) {
        const p = pieceAt(from);
        if (!p) return [];
        return premoveDests(from, p.code).map((to) => ({ to, promotion: false, capture: !!pieceAt(to) }));
      }
      return [];
    },
    [canMove, premoveMode, legal, pieceAt],
  );

  const targets = selected ? targetsFor(selected) : [];

  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (freeMove) {
        if (from !== to) freeMove(from, to);
        return true;
      }
      const t = targetsFor(from).find((x) => x.to === to);
      if (!t) return false;
      if (premoveMode) {
        const p = pieceAt(from);
        const lastRank = (p?.code === 'wP' && to[1] === '8') || (p?.code === 'bP' && to[1] === '1');
        setSelected(null);
        onPremove?.(from + to + (lastRank ? 'q' : ''));
        return true;
      }
      if (t.promotion) {
        setPromo({ from, to });
        return true;
      }
      setSelected(null);
      onMove?.(from + to);
      return true;
    },
    [targetsFor, onMove, onPremove, freeMove, premoveMode, pieceAt],
  );

  const pointToBoard = (e: { clientX: number; clientY: number }) => {
    const r = boardRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 8;
    const y = ((e.clientY - r.top) / r.height) * 8;
    return { x, y, sq: xyToSquare(Math.floor(x), Math.floor(y), orientation) };
  };

  const isMine = (sq: string) => {
    const p = pieceAt(sq);
    if (!p) return false;
    if (freeMove) return true;
    return (canMove || premoveMode) && p.code[0] === color;
  };

  const clearAnnotations = () => {
    if (userArrows.length) setUserArrows([]);
    if (Object.keys(userMarks).length) setUserMarks({});
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (promo) return;
    const { x, y, sq } = pointToBoard(e);
    if (!sq) return;

    // Right button: draw arrows / highlight squares. Also cancels a queued premove.
    if (e.button === 2) {
      if (premove) onPremove?.(null);
      setSelected(null);
      setDrawing({ from: sq, to: sq, color: colorFromEvent(e) });
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* pointer already released */
      }
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    clearAnnotations();
    if (onSquareClick?.(sq)) return;
    if (selected && selected !== sq && targets.some((t) => t.to === sq)) {
      tryMove(selected, sq);
      return;
    }
    if (isMine(sq)) {
      const p = pieceAt(sq)!;
      setSelected(sq);
      dragStart.current = { x, y };
      dragPos.current = { x, y };
      setDrag({ id: p.id, from: sq, moved: false });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    } else {
      if (selected && freeMove) tryMove(selected, sq);
      else if (premove) onPremove?.(null);
      setSelected(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drawing) {
      const { sq } = pointToBoard(e);
      if (sq !== drawing.to) setDrawing({ ...drawing, to: sq });
      return;
    }
    if (!drag) return;
    const { x, y } = pointToBoard(e);
    dragPos.current = { x, y };
    if (!drag.moved) {
      // One render to lift the piece; after that the position is written straight to the DOM.
      if (Math.hypot(x - dragStart.current.x, y - dragStart.current.y) > 0.12) setDrag({ ...drag, moved: true });
      return;
    }
    const el = pieceEls.current.get(drag.id);
    if (el) el.style.transform = dragTransform(x, y);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drawing) {
      // Use the square under the pointer at release (state from the last move may not have rendered yet).
      const { from, color: c } = drawing;
      const to = pointToBoard(e).sq;
      setDrawing(null);
      if (!to) return;
      if (to === from) {
        setUserMarks((m) => {
          const next = { ...m };
          if (next[from] === c) delete next[from];
          else next[from] = c;
          return next;
        });
      } else {
        setUserArrows((as) => {
          const i = as.findIndex((a) => a.from === from && a.to === to);
          if (i >= 0 && as[i].color === c) return as.filter((_, j) => j !== i);
          const rest = as.filter((a) => !(a.from === from && a.to === to));
          return [...rest, { from, to, color: c }];
        });
      }
      return;
    }
    if (!drag) return;
    const { sq } = pointToBoard(e);
    const d = drag;
    setDrag(null);
    if (!d.moved) return; // treated as a click: keep selection
    if (!sq && freeMove && onDropOff) {
      setSelected(null);
      onDropOff(d.from);
      return;
    }
    if (sq && sq !== d.from) {
      if (tryMove(d.from, sq)) {
        if (!premoveMode) setSnapId(d.id);
      } else setSelected(null);
    }
  };

  const registerPiece = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) pieceEls.current.set(id, el);
    else pieceEls.current.delete(id);
  }, []);

  const markRgb = mark ? MARK_RGB[mark.kind] : null;
  const allArrows: BoardArrow[] = [
    ...(arrows ?? []),
    ...userArrows,
    ...(drawing?.to && drawing.to !== drawing.from ? [{ from: drawing.from, to: drawing.to, color: drawing.color }] : []),
  ];

  return (
    <div className={`relative aspect-square w-full select-none ${shaking ? 'animate-shake' : ''} ${className}`}>
      <div
        ref={boardRef}
        className="relative h-full w-full touch-none overflow-hidden rounded-md shadow-[0_18px_50px_-12px_rgb(0_0_0/0.65)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDrag(null);
          setDrawing(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <SquaresLayer
          orientation={orientation}
          lastMove={lastMove}
          selected={selected}
          premove={premove}
          premoveMode={premoveMode}
          tints={tints}
          userMarks={userMarks}
          mark={mark}
          checkSquare={checkSquare}
          pulse={pulse}
          coords={coords}
        />

        {/* Legal move / premove dots */}
        {targets.map((t) => {
          const { col, row } = squareToXY(t.to, orientation);
          const occupied = !!pieceAt(t.to) || t.capture;
          const tone = premoveMode ? '90 60 190' : '15 20 32';
          return (
            <div key={t.to} className="pointer-events-none absolute z-10 flex h-[12.5%] w-[12.5%] items-center justify-center" style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}>
              {occupied ? (
                <div className="h-full w-full animate-dot-in rounded-full" style={{ boxShadow: `inset 0 0 0 5px rgb(${tone} / 0.38)` }} />
              ) : (
                <div className="h-[30%] w-[30%] animate-dot-in rounded-full" style={{ background: `rgb(${tone} / 0.32)` }} />
              )}
            </div>
          );
        })}

        {/* Captured piece: fades out under the capturing piece (overlay only; the capture itself is instant). */}
        {tracked.ghost && (() => {
          const g = tracked.ghost;
          const { col, row } = squareToXY(g.sq, orientation);
          return (
            <div key={`ghost-${g.id}`} className="pointer-events-none absolute left-0 top-0 z-[15] h-[12.5%] w-[12.5%]" style={{ transform: `translate(${col * 100}%, ${row * 100}%)` }}>
              <img src={pieceUrl(g.code)} alt="" draggable={false} className="h-full w-full animate-capture-out" onAnimationEnd={clearGhost} />
            </div>
          );
        })()}

        {/* Pieces */}
        {pieces.map((p) => {
          const { col, row } = squareToXY(p.sq, orientation);
          const dragging = !!drag && drag.id === p.id && drag.moved;
          const transform = dragging ? dragTransform(dragPos.current.x, dragPos.current.y) : `translate(${col * 100}%, ${row * 100}%)`;
          return (
            <PieceView
              key={p.id}
              id={p.id}
              code={p.code}
              transform={transform}
              dragging={dragging}
              snap={snapId === p.id}
              enter={p.isNew ? 'new' : cur.fresh ? 'fresh' : null}
              register={registerPiece}
            />
          );
        })}

        {/* Hint ring drawn above pieces so it is visible even on a busy square */}
        {pulse?.map((sq) => {
          const { col, row } = squareToXY(sq, orientation);
          return (
            <div
              key={`hint-${sq}`}
              className="pointer-events-none absolute z-30 h-[12.5%] w-[12.5%] p-[3%]"
              style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}
            >
              <div className="kf-hint-ring h-full w-full rounded-lg" />
            </div>
          );
        })}

        {/* Arrows (app-supplied + user-drawn) */}
        {allArrows.length > 0 && <ArrowLayer arrows={allArrows} orientation={orientation} />}

        {/* Solved: one light sweep across the board */}
        {sweep > 0 && <div key={`sweep-${sweep}`} className="kf-sweep pointer-events-none absolute inset-0 z-[36]" />}

        {/* Feedback ripple: an expanding ring in the mark's colour (two rings when the puzzle is solved) */}
        {mark && markRgb && (() => {
          const { col, row } = squareToXY(mark.square, orientation);
          const ring = { boxShadow: `0 0 0 3px rgb(${markRgb} / 0.95), 0 0 18px 4px rgb(${markRgb} / 0.6)` };
          const double = mark.kind === 'best' || mark.kind === 'mate';
          return (
            <div
              key={`ripple-${mark.key}`}
              className="pointer-events-none absolute z-40 h-[12.5%] w-[12.5%]"
              style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}
            >
              <div className="absolute inset-0 animate-ripple rounded-[18%]" style={ring} />
              {double && <div className="absolute inset-0 animate-ripple rounded-[18%] [animation-delay:130ms]" style={ring} />}
            </div>
          );
        })()}

        {/* Promotion picker */}
        {promo && (
          <PromotionPicker
            color={color}
            square={promo.to}
            orientation={orientation}
            onPick={(p) => {
              const { from, to } = promo;
              setPromo(null);
              setSelected(null);
              onMove?.(from + to + p);
            }}
            onCancel={() => setPromo(null)}
          />
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * The 64 squares with their tints. Memoised: it re-renders only when a highlight actually changes,
 * not on every parent render (Rush re-renders its board 10×/s for the clock) and never during a drag.
 */
const SquaresLayer = memo(function SquaresLayer({ orientation, lastMove, selected, premove, premoveMode, tints, userMarks, mark, checkSquare, pulse, coords }: {
  orientation: 'white' | 'black';
  lastMove: [string, string] | null | undefined;
  selected: string | null;
  premove: [string, string] | null | undefined;
  premoveMode: boolean;
  tints: Record<string, string> | undefined;
  userMarks: Record<string, ArrowColor>;
  mark: BoardMark | null | undefined;
  checkSquare: string | null;
  pulse: string[] | undefined;
  coords: boolean;
}) {
  const squares = useMemo(() => {
    const out: string[] = [];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) out.push(xyToSquare(col, row, orientation)!);
    return out;
  }, [orientation]);
  const markRgb = mark ? MARK_RGB[mark.kind] : null;

  return (
    <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
      {squares.map((sq) => {
        const light = isLightSquare(sq);
        const isLast = lastMove && (lastMove[0] === sq || lastMove[1] === sq);
        const isPremove = premove && (premove[0] === sq || premove[1] === sq);
        const userMark = userMarks[sq];
        const { col, row } = squareToXY(sq, orientation);
        return (
          <div key={sq} className="relative" style={{ background: light ? 'var(--color-sq-light)' : 'var(--color-sq-dark)' }} data-square={sq}>
            {isLast && <div className="absolute inset-0" style={{ background: 'rgb(255 196 84 / 0.42)' }} />}
            {selected === sq && <div className="absolute inset-0" style={{ background: premoveMode ? PREMOVE_TINT : 'rgb(255 180 84 / 0.55)' }} />}
            {isPremove && <div className="absolute inset-0" style={{ background: PREMOVE_TINT }} />}
            {tints?.[sq] && <div className="absolute inset-0" style={{ background: tints[sq] }} />}
            {userMark && <div className="absolute inset-0" style={{ background: `rgb(${ARROW_RGB[userMark]} / 0.62)` }} />}
            {mark && mark.square === sq && markRgb && (
              <div key={`t${mark.key}`} className="absolute inset-0 animate-pop" style={{ background: `rgb(${markRgb} / 0.46)` }} />
            )}
            {checkSquare === sq && (
              <div className="absolute inset-0 animate-check" style={{ background: 'radial-gradient(circle, rgb(255 60 60 / 0.95) 0%, rgb(230 30 30 / 0.55) 40%, transparent 72%)' }} />
            )}
            {pulse?.includes(sq) && <div className="kf-hint-fill absolute inset-0" />}
            {coords && col === 0 && (
              <span className={`absolute left-[3%] top-[2%] text-[clamp(8px,1.6vw,12px)] font-semibold ${light ? 'text-[var(--color-sq-dark)]' : 'text-[var(--color-sq-light)]'}`}>
                {sq[1]}
              </span>
            )}
            {coords && row === 7 && (
              <span className={`absolute bottom-[1%] right-[4%] text-[clamp(8px,1.6vw,12px)] font-semibold ${light ? 'text-[var(--color-sq-dark)]' : 'text-[var(--color-sq-light)]'}`}>
                {sq[0]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

/** One piece. Memoised so a move re-renders only the piece(s) whose transform changed. */
const PieceView = memo(function PieceView({ id, code, transform, dragging, snap, enter, register }: {
  id: number;
  code: PieceCode;
  transform: string;
  dragging: boolean;
  snap: boolean;
  /** Entrance animation: 'new' = appeared mid-game (promotion / take-back), 'fresh' = position just dealt. */
  enter: 'new' | 'fresh' | null;
  register: (id: number, el: HTMLDivElement | null) => void;
}) {
  const ref = useCallback((el: HTMLDivElement | null) => register(id, el), [id, register]);
  return (
    <div
      ref={ref}
      className={`kf-piece pointer-events-none absolute left-0 top-0 z-20 h-[12.5%] w-[12.5%] ${dragging ? 'dragging' : ''} ${snap ? 'snap' : ''}`}
      style={{ transform }}
    >
      <img src={pieceUrl(code)} alt={code} draggable={false} className={`h-full w-full ${enter === 'new' ? 'animate-piece-in' : enter === 'fresh' ? 'animate-piece-fresh' : ''}`} />
    </div>
  );
});

/** SVG overlay for arrows. Knight moves get an L-shaped arrow. Coordinates: board = 100×100. */
function ArrowLayer({ arrows, orientation }: { arrows: BoardArrow[]; orientation: 'white' | 'black' }) {
  const center = (sq: string) => {
    const { col, row } = squareToXY(sq, orientation);
    return { x: col * 12.5 + 6.25, y: row * 12.5 + 6.25 };
  };
  return (
    <svg className="pointer-events-none absolute inset-0 z-[35] h-full w-full" viewBox="0 0 100 100" aria-hidden>
      {arrows.map((a, i) => {
        const s = center(a.from);
        const e = center(a.to);
        const df = Math.abs(a.from.charCodeAt(0) - a.to.charCodeAt(0));
        const dr = Math.abs(Number(a.from[1]) - Number(a.to[1]));
        const knight = (df === 1 && dr === 2) || (df === 2 && dr === 1);
        // Path points: straight, or an L for knight jumps (long leg first).
        const pts = knight ? (Math.abs(e.x - s.x) > Math.abs(e.y - s.y) ? [s, { x: e.x, y: s.y }, e] : [s, { x: s.x, y: e.y }, e]) : [s, e];
        const isHint = a.color === 'hint';
        const rgb = ARROW_RGB[a.color ?? 'green'];
        const width = isHint ? 2.9 : 2.3;
        const head = isHint ? 5.4 : 4.6;
        // Shorten the last leg so the arrow head ends inside the target square.
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const len = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
        const ux = (last.x - prev.x) / len;
        const uy = (last.y - prev.y) / len;
        const tip = { x: last.x - ux * 1.2, y: last.y - uy * 1.2 };
        const base = { x: tip.x - ux * head, y: tip.y - uy * head };
        const startOffset = knight ? 0 : 3.2;
        const first = { x: pts[0].x + ((pts[1].x - pts[0].x) / (Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1)) * startOffset, y: pts[0].y + ((pts[1].y - pts[0].y) / (Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1)) * startOffset };
        const line = [first, ...pts.slice(1, -1), base].map((p) => `${p.x},${p.y}`).join(' ');
        const px = -uy;
        const py = ux;
        const headPts = `${tip.x},${tip.y} ${base.x + px * head * 0.62},${base.y + py * head * 0.62} ${base.x - px * head * 0.62},${base.y - py * head * 0.62}`;
        return (
          <g
            key={`${a.from}${a.to}${i}`}
            opacity={isHint ? 0.95 : 0.82}
            // SVG transforms default to the canvas origin; pop the hint arrow from its own centre instead.
            style={isHint ? { filter: `drop-shadow(0 0 1.6px rgb(${rgb}))`, transformBox: 'fill-box', transformOrigin: 'center' } : undefined}
            className={isHint ? 'animate-pop' : undefined}
          >
            <polyline points={line} fill="none" stroke={`rgb(${rgb})`} strokeWidth={width} strokeLinejoin="round" strokeLinecap={knight ? 'round' : 'butt'} />
            <polygon points={headPts} fill={`rgb(${rgb})`} />
          </g>
        );
      })}
    </svg>
  );
}

function PromotionPicker({ color, square, orientation, onPick, onCancel }: {
  color: 'w' | 'b';
  square: string;
  orientation: 'white' | 'black';
  onPick: (p: 'q' | 'r' | 'b' | 'n') => void;
  onCancel: () => void;
}) {
  const { col, row } = squareToXY(square, orientation);
  const down = row === 0;
  return (
    <div className="absolute inset-0 z-50 animate-fade-in bg-black/40" onPointerDown={(e) => { e.stopPropagation(); onCancel(); }}>
      {PROMO.map((p, i) => {
        const r = down ? row + i : row - i;
        return (
          <button
            key={p}
            className="absolute flex h-[12.5%] w-[12.5%] animate-pop items-center justify-center rounded-full bg-ink-100 shadow-xl transition hover:scale-105 hover:bg-ember-300"
            style={{ left: `${col * 12.5}%`, top: `${r * 12.5}%`, animationDelay: `${i * 25}ms` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPick(p);
            }}
          >
            <img src={pieceUrl(`${color}${p.toUpperCase()}` as PieceCode)} alt={p} className="h-[88%] w-[88%]" draggable={false} />
          </button>
        );
      })}
    </div>
  );
}

export { FILES };
export type { TrackedPiece };
