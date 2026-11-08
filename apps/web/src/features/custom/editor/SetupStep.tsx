import { useMemo, useRef, useState } from 'react';
import { Board, pieceUrl, type PieceCode } from '../../../shared/Board/index.ts';
import { burstAt, PALETTES, sfx } from '../../../shared/fx/index.ts';
import { Button, GameLayout, Icons, Panel } from '../../../shared/ui.tsx';
import { Kbd, StatusLine, useHotkeys } from '../bits.tsx';
import {
  EMPTY_FEN,
  START_FEN,
  parseFen,
  possibleCastling,
  sideName,
  toFen,
  validatePosition,
  type CastleFlag,
  type EditorPosition,
  type PieceChar,
  type Side,
} from '../logic.ts';

export type Tool = 'move' | 'erase' | PieceChar;

const WHITE_PIECES: PieceChar[] = ['K', 'Q', 'R', 'B', 'N', 'P'];
const BLACK_PIECES: PieceChar[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const PIECE_NAMES: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

function codeOf(p: PieceChar): PieceCode {
  return `${p === p.toUpperCase() ? 'w' : 'b'}${p.toUpperCase()}` as PieceCode;
}

function fromFen(fen: string): EditorPosition {
  const r = parseFen(fen);
  if (!r.ok) throw new Error(r.error);
  return r.position;
}

export interface SetupStepProps {
  position: EditorPosition;
  setPosition: (p: EditorPosition) => void;
  orientation: 'white' | 'black';
  setOrientation: (o: 'white' | 'black') => void;
  onContinue: () => void;
}

export function SetupStep({ position, setPosition, orientation, setOrientation, onContinue }: SetupStepProps) {
  const [tool, setTool] = useState<Tool>('move');
  const [shakeKey, setShakeKey] = useState(0);
  const [fenDraft, setFenDraft] = useState<string | null>(null);
  const [fenError, setFenError] = useState<string | null>(null);
  const boardWrap = useRef<HTMLDivElement>(null);

  const fen = toFen(position);
  const error = useMemo(() => validatePosition(fen), [fen]);
  const possible = possibleCastling(position.pieces);

  const sparkAt = (sq: string, colors = PALETTES.ember) =>
    burstAt(boardWrap.current?.querySelector(`[data-square="${sq}"]`), { count: 9, power: 3.2, size: 4, colors, life: 32, gravity: 0.08 });

  /** Apply a change to the placement; en passant is dropped since it no longer applies. */
  const editPieces = (fn: (pieces: Record<string, PieceChar>) => void) => {
    const pieces = { ...position.pieces };
    fn(pieces);
    setPosition({ ...position, pieces, ep: '-' });
  };

  const onSquareClick = (sq: string): boolean => {
    if (tool === 'move') return false;
    if (tool === 'erase') {
      if (position.pieces[sq]) {
        editPieces((p) => delete p[sq]);
        sfx.capture();
        sparkAt(sq, PALETTES.bad);
      }
      return true;
    }
    if (position.pieces[sq] === tool) {
      // Clicking the same piece again removes it (fast toggling).
      editPieces((p) => delete p[sq]);
      sfx.click();
      return true;
    }
    editPieces((p) => {
      // Only one king per side: placing a king moves it.
      if (tool === 'K' || tool === 'k') for (const s of Object.keys(p)) if (p[s] === tool) delete p[s];
      p[sq] = tool;
    });
    sfx.move();
    sparkAt(sq);
    return true;
  };

  const freeMove = (from: string, to: string) => {
    const piece = position.pieces[from];
    if (!piece) return;
    const capture = !!position.pieces[to];
    editPieces((p) => {
      delete p[from];
      p[to] = piece;
    });
    if (capture) sfx.capture();
    else sfx.move();
  };

  /** Dragged off the board: remove the piece. */
  const dropOff = (from: string) => {
    if (!position.pieces[from]) return;
    editPieces((p) => delete p[from]);
    sfx.capture();
  };

  const setTurn = (turn: Side) => {
    if (turn === position.turn) return;
    setPosition({ ...position, turn, ep: '-' });
    sfx.click();
  };

  const toggleCastle = (c: CastleFlag) => setPosition({ ...position, castling: { ...position.castling, [c]: !position.castling[c] } });

  const load = (f: string, sound: () => void) => {
    // Castling stays "wanted" so it switches on automatically once king + rook are home.
    setPosition({ ...fromFen(f), castling: { K: true, Q: true, k: true, q: true } });
    setFenDraft(null);
    setFenError(null);
    sound();
  };

  const flip = () => {
    setOrientation(orientation === 'white' ? 'black' : 'white');
    sfx.click();
  };

  const tryContinue = () => {
    if (error) {
      setShakeKey((k) => k + 1);
      sfx.wrong();
      return;
    }
    sfx.correct();
    onContinue();
  };

  const onFenChange = (text: string) => {
    setFenDraft(text);
    const r = parseFen(text);
    if (r.ok) {
      setPosition(r.position);
      setFenError(null);
    } else setFenError(r.error);
  };

  const hotkeys: Record<string, () => void> = {
    f: flip,
    x: () => setTool('erase'),
    Escape: () => setTool('move'),
    m: () => setTool('move'),
    t: () => setTurn(position.turn === 'w' ? 'b' : 'w'),
  };
  for (const p of [...WHITE_PIECES, ...BLACK_PIECES]) hotkeys[p] = () => setTool((t) => (t === p ? 'move' : p));
  useHotkeys(hotkeys);

  const boardCursor = tool === 'move' ? '' : tool === 'erase' ? '[&_*]:cursor-[not-allowed]' : '[&_*]:cursor-copy';

  const palette = (
    <div className="mt-3 rounded-2xl border border-ink-700/60 bg-ink-850 p-2.5">
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {WHITE_PIECES.map((p) => (
          <PaletteButton key={p} active={tool === p} onClick={() => setTool(tool === p ? 'move' : p)} label={`White ${PIECE_NAMES[p]} (${p})`}>
            <img src={pieceUrl(codeOf(p))} alt="" className="h-full w-full" draggable={false} />
          </PaletteButton>
        ))}
        <PaletteButton active={tool === 'move'} onClick={() => setTool('move')} label="Move pieces (M / Esc)">
          <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
          </svg>
        </PaletteButton>
        {BLACK_PIECES.map((p) => (
          <PaletteButton key={p} active={tool === p} onClick={() => setTool(tool === p ? 'move' : p)} label={`Black ${PIECE_NAMES[p.toUpperCase()]} (${p})`}>
            <img src={pieceUrl(codeOf(p))} alt="" className="h-full w-full" draggable={false} />
          </PaletteButton>
        ))}
        <PaletteButton active={tool === 'erase'} onClick={() => setTool(tool === 'erase' ? 'move' : 'erase')} label="Eraser (X)" danger>
          <svg viewBox="0 0 24 24" className="h-[66%] w-[66%]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 20H8l-4-4a2 2 0 010-2.8L13.2 4a2 2 0 012.8 0l4 4a2 2 0 010 2.8L12 19" />
            <path d="M7 11l6 6" />
          </svg>
        </PaletteButton>
      </div>
      <p className="mt-2 px-1 text-xs text-ink-400">
        {tool === 'move'
          ? 'Drag pieces anywhere (drop one off the board to remove it), or pick a piece above and click squares to place it.'
          : tool === 'erase'
            ? 'Click pieces to remove them.'
            : `Click squares to place the ${tool === tool.toUpperCase() ? 'white' : 'black'} ${PIECE_NAMES[tool.toUpperCase()]}. Click it again to remove.`}
      </p>
    </div>
  );

  return (
    <GameLayout
      board={
        <>
          <div ref={boardWrap} className={boardCursor}>
            <Board fen={fen} orientation={orientation} freeMove={freeMove} onDropOff={dropOff} onSquareClick={onSquareClick} shakeKey={shakeKey} />
          </div>
          {palette}
        </>
      }
      side={
        <Panel className="space-y-4">
          <div>
            <Label>Side to move</Label>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-900 p-1">
              {(['w', 'b'] as Side[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTurn(s)}
                  className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold transition ${
                    position.turn === s ? 'bg-ink-700 text-ink-100 shadow' : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  <span className={`h-3.5 w-3.5 rounded-sm ${s === 'w' ? 'bg-ink-100' : 'bg-ink-950 ring-1 ring-ink-400'}`} />
                  {sideName(s)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" onClick={flip} title="Flip board (F)">
              {Icons.flip('h-4 w-4')} Flip
            </Button>
            <Button size="sm" onClick={() => load(EMPTY_FEN.replace(' w ', ` ${position.turn} `), () => sfx.capture())} title="Empty the board">
              Clear
            </Button>
            <Button size="sm" onClick={() => load(START_FEN, () => sfx.castle())} title="Starting position">
              Start
            </Button>
          </div>

          <div>
            <Label>Castling rights</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['K', 'White O-O'],
                  ['Q', 'White O-O-O'],
                  ['k', 'Black O-O'],
                  ['q', 'Black O-O-O'],
                ] as [CastleFlag, string][]
              ).map(([c, label]) => (
                <label
                  key={c}
                  className={`flex items-center gap-2 rounded-lg bg-ink-900 px-2.5 py-1.5 text-sm ${possible[c] ? 'cursor-pointer text-ink-200' : 'cursor-not-allowed text-ink-500'}`}
                  title={possible[c] ? undefined : 'King and rook must be on their starting squares'}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-ember-500)]"
                    disabled={!possible[c]}
                    checked={possible[c] && position.castling[c]}
                    onChange={() => toggleCastle(c)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label>FEN</Label>
            <textarea
              value={fenDraft ?? fen}
              onChange={(e) => onFenChange(e.target.value)}
              onFocus={(e) => {
                setFenDraft(fen);
                e.currentTarget.select();
              }}
              onBlur={() => {
                setFenDraft(null);
                setFenError(null);
              }}
              rows={2}
              spellCheck={false}
              className={`w-full resize-none rounded-xl border bg-ink-900 px-3 py-2 font-mono text-xs leading-relaxed text-ink-200 outline-none transition focus:border-ember-500 ${
                fenError ? 'border-bad-500' : 'border-ink-700'
              }`}
              aria-invalid={!!fenError}
              aria-label="FEN"
            />
            {fenError && <p className="mt-1 text-xs font-semibold text-bad-400">{fenError}</p>}
          </div>

          <StatusLine error={error} okText={`Position is valid — ${sideName(position.turn)} to move.`} />

          <Button variant="primary" size="lg" className="w-full" onClick={tryContinue}>
            Record solution {Icons.next('h-5 w-5')}
          </Button>

          <div className="hidden flex-wrap gap-x-3 gap-y-1.5 text-xs text-ink-400 sm:flex">
            <span>
              <Kbd>K</Kbd>…<Kbd>p</Kbd> pick piece
            </span>
            <span>
              <Kbd>X</Kbd> eraser
            </span>
            <span>
              <Kbd>F</Kbd> flip
            </span>
            <span>
              <Kbd>T</Kbd> side to move
            </span>
          </div>
        </Panel>
      }
    />
  );
}

function PaletteButton({ active, onClick, label, danger, children }: { active: boolean; onClick: () => void; label: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => {
        sfx.click();
        onClick();
      }}
      className={`flex aspect-square items-center justify-center rounded-xl p-1 transition duration-100 active:scale-90 ${
        active
          ? danger
            ? 'scale-105 bg-bad-500/25 text-bad-400 ring-2 ring-bad-400'
            : 'scale-105 bg-ember-500/20 text-ember-400 ring-2 ring-ember-400'
          : 'bg-ink-800 text-ink-300 hover:-translate-y-0.5 hover:bg-ink-700'
      }`}
    >
      {children}
    </button>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-ink-400">{children}</div>;
}
