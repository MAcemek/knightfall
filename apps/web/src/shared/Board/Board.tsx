import { Chess, type Square } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FILES, isLightSquare, parseFenPieces, pieceUrl, squareToXY, trackPieces, xyToSquare, type PieceCode, type TrackedPiece } from './pieces.ts';

export type MarkKind = 'correct' | 'wrong' | 'mate' | 'hint' | 'best';

export interface BoardMark {
  square: string;
  kind: MarkKind;
  /** Change to replay the pop animation on the same square. */
  key?: string | number;
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
  /** Squares to pulse (e.g. hint origin). */
  pulse?: string[];
  /** Extra square tints, e.g. editor selections. */
  tints?: Record<string, string>;
  /** Called with a legal UCI move (promotion included). */
  onMove?: (uci: string) => void;
  /** Free mode (editor): any piece to any square, no legality. Called with from/to. */
  freeMove?: (from: string, to: string) => void;
  /** Called on clicking a square (editor painting). Return true to consume the click. */
  onSquareClick?: (sq: string) => boolean | void;
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

/**
 * Knightfall chessboard: click-to-move + drag-and-drop, legal-move dots, sliding pieces,
 * last-move & check highlights, promotion picker, feedback badges and shake.
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
  onMove,
  freeMove,
  onSquareClick,
  shakeKey = 0,
  showCoords = true,
  className = '',
  children,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [pieces, setPieces] = useState<TrackedPiece[]>(() => trackPieces([], parseFenPieces(fen)));
  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<{ id: number; from: Square; x: number; y: number; moved: boolean } | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [shaking, setShaking] = useState(false);

  // Re-track pieces when the position changes so moved pieces keep identity and slide.
  useEffect(() => {
    setPieces((prev) => trackPieces(prev, parseFenPieces(fen)));
    setSelected(null);
    setPromo(null);
  }, [fen]);

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

  const targets = selected ? legal.get(selected) ?? [] : [];

  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (freeMove) {
        if (from !== to) freeMove(from, to);
        return true;
      }
      const t = (legal.get(from) ?? []).find((x) => x.to === to);
      if (!t) return false;
      if (t.promotion) {
        setPromo({ from, to });
        return true;
      }
      setSelected(null);
      onMove?.(from + to);
      return true;
    },
    [legal, onMove, freeMove],
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
    return canMove && p.code[0] === color;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || promo) return;
    const { x, y, sq } = pointToBoard(e);
    if (!sq) return;
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
      setSelected(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { x, y } = pointToBoard(e);
    const moved = drag.moved || Math.hypot(x - drag.x, y - drag.y) > 0.12;
    setDrag({ ...drag, x, y, moved });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const { sq } = pointToBoard(e);
    const d = drag;
    setDrag(null);
    if (!d.moved) return; // treated as a click: keep selection
    if (sq && sq !== d.from) {
      if (!tryMove(d.from, sq)) setSelected(null);
    }
  };

  const squares = useMemo(() => {
    const out: string[] = [];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) out.push(xyToSquare(col, row, orientation)!);
    return out;
  }, [orientation]);

  const markStyle = mark ? MARK_STYLE[mark.kind] : null;

  return (
    <div className={`relative aspect-square w-full select-none ${shaking ? 'animate-shake' : ''} ${className}`}>
      <div
        ref={boardRef}
        className="relative h-full w-full touch-none overflow-hidden rounded-md shadow-[0_18px_50px_-12px_rgb(0_0_0/0.65)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Squares */}
        <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
          {squares.map((sq) => {
            const light = isLightSquare(sq);
            const isLast = lastMove && (lastMove[0] === sq || lastMove[1] === sq);
            const { col, row } = squareToXY(sq, orientation);
            return (
              <div key={sq} className="relative" style={{ background: light ? 'var(--color-sq-light)' : 'var(--color-sq-dark)' }} data-square={sq}>
                {isLast && <div className="absolute inset-0" style={{ background: 'rgb(255 196 84 / 0.42)' }} />}
                {selected === sq && <div className="absolute inset-0" style={{ background: 'rgb(255 180 84 / 0.55)' }} />}
                {tints?.[sq] && <div className="absolute inset-0" style={{ background: tints[sq] }} />}
                {mark && mark.square === sq && markStyle && (
                  <div key={`t${mark.key}`} className="absolute inset-0 animate-pop" style={{ background: markStyle.tint }} />
                )}
                {checkSquare === sq && (
                  <div className="absolute inset-0" style={{ background: 'radial-gradient(circle, rgb(255 60 60 / 0.95) 0%, rgb(230 30 30 / 0.55) 40%, transparent 72%)' }} />
                )}
                {pulse?.includes(sq) && <div className="absolute inset-0 animate-pulse-ring" />}
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

        {/* Legal move hints */}
        {targets.map((t) => {
          const { col, row } = squareToXY(t.to, orientation);
          const occupied = !!pieceAt(t.to) || t.capture;
          return (
            <div key={t.to} className="pointer-events-none absolute z-10 flex h-[12.5%] w-[12.5%] items-center justify-center" style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}>
              {occupied ? (
                <div className="h-full w-full rounded-full" style={{ boxShadow: 'inset 0 0 0 5px rgb(15 20 32 / 0.32)' }} />
              ) : (
                <div className="h-[30%] w-[30%] rounded-full bg-[rgb(15_20_32/0.3)]" />
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
              className={`kf-piece pointer-events-none absolute left-0 top-0 z-20 h-[12.5%] w-[12.5%] ${dragging ? 'dragging' : ''}`}
              style={{ transform }}
            >
              <img src={pieceUrl(p.code)} alt={p.code} draggable={false} className={`h-full w-full ${p.isNew ? 'animate-piece-in' : ''}`} />
            </div>
          );
        })}

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
