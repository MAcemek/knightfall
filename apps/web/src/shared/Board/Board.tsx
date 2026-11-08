import { Chess, type Square } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FILES, isLightSquare, parseFenPieces, pieceUrl, premoveDests, squareToXY, trackPieces, xyToSquare,
  type PieceCode, type TrackedPiece,
} from './pieces.ts';

export type MarkKind = 'correct' | 'wrong' | 'mate' | 'hint' | 'best';

export interface BoardMark {
  square: string;
  kind: MarkKind;
  /** Change to replay the pop animation on the same square. */
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
  /** Badge over a square (✓ / ✗ / # / 💡). */
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
  /** Increment to shake the board. */
  shakeKey?: number;
  showCoords?: boolean;
  className?: string;
  children?: ReactNode;
}

const PROMO: ('q' | 'r' | 'b' | 'n')[] = ['q', 'n', 'r', 'b'];

const MARK_STYLE: Record<MarkKind, { bg: string; glyph: string; tint: string }> = {
  correct: { bg: 'bg-good-500', glyph: '✓', tint: 'rgb(47 207 111 / 0.42)' },
  best: { bg: 'bg-good-500', glyph: '★', tint: 'rgb(47 207 111 / 0.42)' },
  mate: { bg: 'bg-ember-500', glyph: '#', tint: 'rgb(255 154 31 / 0.45)' },
  wrong: { bg: 'bg-bad-500', glyph: '✗', tint: 'rgb(240 72 72 / 0.5)' },
  hint: { bg: 'bg-sky-400', glyph: '?', tint: 'rgb(108 196 255 / 0.4)' },
};

const ARROW_RGB: Record<ArrowColor, string> = {
  green: '21 160 72',
  red: '226 64 52',
  blue: '40 120 230',
  yellow: '240 175 20',
  hint: '255 154 31',
};

const PREMOVE_TINT = 'rgb(140 110 230 / 0.55)';

/** Arrow / highlight colour from modifier keys (like the big chess sites). */
function colorFromEvent(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): ArrowColor {
  if (e.shiftKey && (e.ctrlKey || e.metaKey)) return 'yellow';
  if (e.shiftKey) return 'red';
  if (e.ctrlKey || e.metaKey) return 'blue';
  if (e.altKey) return 'yellow';
  return 'green';
}

/**
 * Knightfall chessboard: click-to-move + drag-and-drop, legal-move dots, sliding pieces,
 * premoves, right-click arrows & square highlights, last-move & check highlights,
 * promotion picker, feedback badges and shake.
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
  shakeKey = 0,
  showCoords = true,
  className = '',
  children,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<{ id: number; from: Square; x: number; y: number; moved: boolean } | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [shaking, setShaking] = useState(false);
  /** Piece dropped by drag: it lands instantly instead of sliding from its origin. */
  const [snapId, setSnapId] = useState<number | null>(null);

  // User annotations (right mouse button).
  const [userArrows, setUserArrows] = useState<BoardArrow[]>([]);
  const [userMarks, setUserMarks] = useState<Record<string, ArrowColor>>({});
  const [drawing, setDrawing] = useState<{ from: string; to: string | null; color: ArrowColor } | null>(null);

  // Track pieces synchronously during render (no one-frame lag) so moves feel instant.
  const [tracked, setTracked] = useState(() => ({ fen, pieces: trackPieces([], parseFenPieces(fen)) }));
  let pieces = tracked.pieces;
  if (tracked.fen !== fen) {
    pieces = trackPieces(tracked.pieces, parseFenPieces(fen));
    setTracked({ fen, pieces });
    setSelected(null);
    setPromo(null);
  }

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
      setDrag({ id: p.id, from: sq, x, y, moved: false });
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
    const moved = drag.moved || Math.hypot(x - drag.x, y - drag.y) > 0.12;
    setDrag({ ...drag, x, y, moved });
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

  const squares = useMemo(() => {
    const out: string[] = [];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) out.push(xyToSquare(col, row, orientation)!);
    return out;
  }, [orientation]);

  const markStyle = mark ? MARK_STYLE[mark.kind] : null;
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
        {/* Squares */}
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
                {mark && mark.square === sq && markStyle && (
                  <div key={`t${mark.key}`} className="absolute inset-0 animate-pop" style={{ background: markStyle.tint }} />
                )}
                {checkSquare === sq && (
                  <div className="absolute inset-0" style={{ background: 'radial-gradient(circle, rgb(255 60 60 / 0.95) 0%, rgb(230 30 30 / 0.55) 40%, transparent 72%)' }} />
                )}
                {pulse?.includes(sq) && <div className="absolute inset-0 animate-hint-fill" />}
                {showCoords && col === 0 && (
                  <span className={`absolute left-[3%] top-[2%] text-[clamp(8px,1.6vw,12px)] font-semibold ${light ? 'text-[var(--color-sq-dark)]' : 'text-[var(--color-sq-light)]'}`}>
                    {sq[1]}
                  </span>
                )}
                {showCoords && row === 7 && (
                  <span className={`absolute bottom-[1%] right-[4%] text-[clamp(8px,1.6vw,12px)] font-semibold ${light ? 'text-[var(--color-sq-dark)]' : 'text-[var(--color-sq-light)]'}`}>
                    {sq[0]}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Legal move / premove dots */}
        {targets.map((t) => {
          const { col, row } = squareToXY(t.to, orientation);
          const occupied = !!pieceAt(t.to) || t.capture;
          const tone = premoveMode ? '90 60 190' : '15 20 32';
          return (
            <div key={t.to} className="pointer-events-none absolute z-10 flex h-[12.5%] w-[12.5%] items-center justify-center" style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}>
              {occupied ? (
                <div className="h-full w-full rounded-full" style={{ boxShadow: `inset 0 0 0 5px rgb(${tone} / 0.38)` }} />
              ) : (
                <div className="h-[30%] w-[30%] rounded-full" style={{ background: `rgb(${tone} / 0.32)` }} />
              )}
            </div>
          );
        })}

        {/* Pieces */}
        {pieces.map((p) => {
          const { col, row } = squareToXY(p.sq, orientation);
          const dragging = drag && drag.id === p.id && drag.moved;
          const transform = dragging ? `translate(${(drag.x - 0.5) * 100}%, ${(drag.y - 0.5) * 100}%) scale(1.08)` : `translate(${col * 100}%, ${row * 100}%)`;
          return (
            <div
              key={p.id}
              className={`kf-piece pointer-events-none absolute left-0 top-0 z-20 h-[12.5%] w-[12.5%] ${dragging ? 'dragging' : ''} ${snapId === p.id ? 'snap' : ''}`}
              style={{ transform }}
            >
              <img src={pieceUrl(p.code)} alt={p.code} draggable={false} className={`h-full w-full ${p.isNew ? 'animate-piece-in' : ''}`} />
            </div>
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
              <div className="h-full w-full animate-hint-ring rounded-lg" />
            </div>
          );
        })}

        {/* Arrows (app-supplied + user-drawn) */}
        {allArrows.length > 0 && <ArrowLayer arrows={allArrows} orientation={orientation} />}

        {/* Feedback badge */}
        {mark && markStyle && (() => {
          const { col, row } = squareToXY(mark.square, orientation);
          return (
            <div
              key={`b${mark.key}`}
              className="pointer-events-none absolute z-40 flex h-[12.5%] w-[12.5%] justify-end"
              style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}
            >
              <div
                className={`-mr-[18%] -mt-[18%] flex h-[44%] w-[44%] animate-pop items-center justify-center rounded-full ${markStyle.bg} text-[clamp(10px,2.2vw,18px)] font-black text-white shadow-lg ring-2 ring-white/80`}
              >
                {markStyle.glyph}
              </div>
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
    <div className="absolute inset-0 z-50 bg-black/40" onPointerDown={(e) => { e.stopPropagation(); onCancel(); }}>
      {PROMO.map((p, i) => {
        const r = down ? row + i : row - i;
        return (
          <button
            key={p}
            className="absolute flex h-[12.5%] w-[12.5%] items-center justify-center rounded-full bg-ink-100 shadow-xl transition hover:scale-105 hover:bg-ember-300"
            style={{ left: `${col * 12.5}%`, top: `${r * 12.5}%` }}
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
