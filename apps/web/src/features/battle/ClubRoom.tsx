import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { BATTLE_MAX_STRIKES, formatCode, rampFor, type ClubPlayer } from '@knightfall/core';
import { sfx, TickerNumber } from '../../shared/fx/index.ts';
import { Button, Icons, Modal, Panel, Pill } from '../../shared/ui.tsx';
import { leaveClub, newClubRace, reportClubProgress, startClubRace } from '../../shared/battle/clubStore.ts';
import { serverNow } from '../../shared/battle/connection.ts';
import { clubLink, isHost, ordinal, rankPlayers, raceKey, type ClubRoom as Room } from './clubLogic.ts';
import { describeSettings } from './friendSettings.ts';
import type { PlayedPuzzle } from './battleState.ts';
import { RaceBoard, useTimeUp } from './RaceBoard.tsx';
import { formatClock, useNow } from './util.ts';

/** The club room: lobby, race (the shared RaceBoard plus a live ranking) and results. */
export function ClubRoom({ room }: { room: Room }) {
  if (room.phase === 'lobby') return <LobbyView room={room} />;
  if (room.phase === 'ended') return <EndView room={room} />;
  if (!room.participating || room.seed === undefined) return <SpectatorView room={room} />;
  return <RaceView key={raceKey(room)} room={room} seed={room.seed} />;
}

// ---- lobby ---------------------------------------------------------------------------------------------------

function LobbyView({ room }: { room: Room }) {
  const host = isHost(room);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const link = clubLink(location.origin, room.code);

  const flash = (kind: 'code' | 'link') => {
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  };
  const copy = async (text: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      flash(kind);
    } catch {
      /* clipboard blocked: nothing to confirm */
    }
  };
  const share = async () => {
    if (!navigator.share) return void copy(link, 'link');
    try {
      await navigator.share({ title: 'Knightfall club room', text: `Join my Knightfall club room! Code: ${formatCode(room.code)}`, url: link });
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') void copy(link, 'link');
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[1fr_340px]">
      <Panel className="space-y-4">
        <div>
          <div className="text-xs font-semibold text-ink-400">Club room code</div>
          <div className="mt-1 font-mono text-4xl font-black tracking-widest text-ink-100" data-testid="club-code">
            {formatCode(room.code)}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => void copy(formatCode(room.code), 'code')}>
              {copied === 'code' ? Icons.check('h-4 w-4') : null} {copied === 'code' ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => void share()}>
              {copied === 'link' ? Icons.check('h-4 w-4') : Icons.share('h-4 w-4')} {copied === 'link' ? 'Link copied' : 'Share'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-300">
          <Pill className="bg-sky-400/15 text-sky-400">Casual</Pill>
          <span className="font-semibold text-ink-100">{describeSettings(room.settings)}</span>
          <span>· {BATTLE_MAX_STRIKES} strikes and you are out</span>
        </div>
        {host ? (
          <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => startClubRace()}>
            {Icons.bolt('h-5 w-5')} Start race
          </Button>
        ) : (
          <div className="rounded-xl bg-ink-800/60 px-4 py-3 text-sm font-semibold text-ink-300" role="status">
            Waiting for the host to start the race…
          </div>
        )}
        <Button variant="ghost" className="min-h-11" onClick={leaveClub}>
          Leave room
        </Button>
      </Panel>
      <PlayerList room={room} title={`Players (${room.players.length})`} />
    </div>
  );
}

function PlayerList({ room, title }: { room: Room; title: string }) {
  return (
    <Panel className="h-fit">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-ink-400">{title}</h2>
      <ul className="space-y-1.5">
        {room.players.map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-xl bg-ink-800/60 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {p.name} {p.id === room.you && <span className="text-ember-400">(you)</span>}
            </span>
            {p.id === room.hostId && <Pill className="bg-ember-500/15 text-ember-300">Host</Pill>}
            {!p.connected && <span className="text-xs text-ink-400">away</span>}
            <span className="font-mono text-xs text-ink-400">{p.rating}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---- race ----------------------------------------------------------------------------------------------------

function RaceView({ room, seed }: { room: Room; seed: number }) {
  const playing = room.phase === 'playing';
  const [history, setHistory] = useState<PlayedPuzzle[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const score = useRef({ solved: 0, strikes: 0 });
  const myScoreRef = useRef<HTMLDivElement>(null);
  const timeUp = useTimeUp(room.endsAt ?? 0, serverNow);
  const ramp = useMemo(() => rampFor(room.settings.level), [room.settings.level]);

  // The same bookkeeping as a 1v1 battle: my own count is shown at once, the server hears `progress`.
  const onResult = (puzzle: { id: string; rating: number }, solved: boolean) => {
    const s = score.current;
    if (s.strikes >= BATTLE_MAX_STRIKES) return;
    const index = s.solved + s.strikes;
    if (solved) s.solved++;
    else s.strikes++;
    setHistory((h) => [...h, { ...puzzle, solved }]);
    reportClubProgress(index, s.solved, s.strikes);
  };

  const mine = { solved: history.filter((h) => h.solved).length, strikes: history.filter((h) => !h.solved).length };
  const players = room.players.map((p) => (p.id === room.you ? { ...p, ...mine } : p));

  return (
    <>
      <RaceBoard
        seed={seed}
        ramp={ramp}
        playing={playing}
        timeUp={timeUp}
        strikes={mine.strikes}
        history={history}
        onResult={onResult}
        scoreRef={myScoreRef}
        waitingText="Waiting for the race to finish…"
        top={<ClubHud room={room} players={players} mine={mine} scoreRef={myScoreRef} />}
        sideExtra={<Ranking room={room} players={players} />}
        sideFooter={
          <div className="flex items-center justify-between gap-3 border-t border-ink-700/60 pt-3">
            <div className="min-w-0 text-sm">
              <div className="text-xs text-ink-400">Club room</div>
              <div className="truncate font-mono font-semibold">{formatCode(room.code)}</div>
            </div>
            <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setConfirmLeave(true)}>
              {Icons.x('h-4 w-4')} Leave race
            </Button>
          </div>
        }
      />
      <Modal open={confirmLeave} onClose={() => setConfirmLeave(false)}>
        <h2 className="text-xl font-extrabold">Leave this race?</h2>
        <p className="mt-2 text-sm text-ink-300">
          You are out of the race and leave the room. This is a casual race, so your battle rating stays the same.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
            Keep playing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmLeave(false);
              leaveClub();
            }}
          >
            Leave
          </Button>
        </div>
      </Modal>
    </>
  );
}

function ClubHud({ room, players, mine, scoreRef }: {
  room: Room;
  players: ClubPlayer[];
  mine: { solved: number; strikes: number };
  scoreRef: RefObject<HTMLDivElement | null>;
}) {
  const counting = room.phase === 'countdown';
  useNow(200, true);
  const left = room.endsAt ? Math.max(0, room.endsAt - serverNow()) : room.settings.durationMs;
  const urgent = room.phase === 'playing' && left > 0 && left <= 10_000;
  const secs = Math.ceil(left / 1000);
  const lastSec = useRef(secs);
  useEffect(() => {
    if (urgent && secs !== lastSec.current) sfx.tick();
    lastSec.current = secs;
  }, [secs, urgent]);

  const ranked = rankPlayers(players);
  const rank = ranked.find((r) => r.player.id === room.you)?.rank ?? ranked.length;
  const startIn = counting && room.startsAt ? Math.max(1, Math.ceil((room.startsAt - serverNow()) / 1000)) : 0;
  const out = mine.strikes >= BATTLE_MAX_STRIKES;

  return (
    <div className="mb-3 rounded-2xl border border-ink-700/60 bg-ink-850 p-3 shadow-xl shadow-black/20 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div
            ref={scoreRef}
            className={`flex h-11 min-w-12 items-center justify-center rounded-xl bg-ember-500/15 px-2 font-mono text-3xl font-black text-ember-400 sm:h-14 sm:min-w-14 sm:text-4xl ${out ? 'opacity-50' : ''}`}
          >
            <TickerNumber value={mine.solved} duration={0.35} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Your rank</div>
            <div className="font-bold">
              {ordinal(rank)} <span className="text-sm font-semibold text-ink-400">of {players.length}</span>
            </div>
            <div className="mt-0.5 flex gap-1" aria-label={`${mine.strikes} strikes`}>
              {Array.from({ length: BATTLE_MAX_STRIKES }, (_, i) => (
                <span key={i} className={`flex h-4 w-4 items-center justify-center rounded text-[10px] font-black ${i < mine.strikes ? 'bg-bad-500 text-white' : 'bg-ink-700 text-ink-500'}`}>
                  ✗
                </span>
              ))}
            </div>
          </div>
        </div>
        <div
          className={`rounded-xl px-3 py-1.5 font-mono text-2xl font-black tabular sm:text-3xl ${urgent ? 'animate-pulse bg-bad-500/20 text-bad-400' : 'bg-ink-800 text-ink-100'}`}
          aria-label={counting ? 'Starts in' : 'Time left'}
        >
          {counting ? startIn : formatClock(left)}
        </div>
      </div>
    </div>
  );
}

/** Live ranking. Below the board on phones, in the side column on desktop. */
function Ranking({ room, players }: { room: Room; players: ClubPlayer[] }) {
  const ranked = rankPlayers(players);
  return (
    <Panel>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">Ranking</h2>
      <ol className="max-h-80 space-y-1.5 overflow-y-auto" data-testid="club-ranking">
        {ranked.map(({ player: p, rank }) => (
          <li key={p.id} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${p.id === room.you ? 'bg-ember-500/15 ring-1 ring-ember-500/40' : 'bg-ink-800/60'}`}>
            <span className="w-7 shrink-0 font-mono text-sm font-bold text-ink-400">{rank}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {p.name}
              {p.id === room.you && <span className="text-ember-400"> (you)</span>}
            </span>
            {(p.out || p.strikes >= BATTLE_MAX_STRIKES) && <span className="text-[10px] font-bold uppercase text-bad-400">Out</span>}
            {!p.connected && <span className="text-[10px] font-bold uppercase text-ink-400">Away</span>}
            <span className="flex gap-0.5" aria-label={`${p.strikes} strikes`}>
              {Array.from({ length: BATTLE_MAX_STRIKES }, (_, i) => (
                <span key={i} className={`h-2 w-2 rounded-full ${i < p.strikes ? 'bg-bad-500' : 'bg-ink-700'}`} />
              ))}
            </span>
            <span className="w-8 text-right font-mono text-sm font-black text-ink-100">{p.solved}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ---- spectating and results ----------------------------------------------------------------------------------

function SpectatorView({ room }: { room: Room }) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Panel className="space-y-3 text-center">
        <div className="text-xl font-extrabold">A race is in progress</div>
        <p className="text-sm text-ink-300">You joined during a race, so you will play in the next one. Watch the ranking meanwhile.</p>
        <Button variant="ghost" className="min-h-11" onClick={leaveClub}>
          Leave room
        </Button>
      </Panel>
      <Ranking room={room} players={room.players} />
    </div>
  );
}

function EndView({ room }: { room: Room }) {
  const host = isHost(room);
  const ranked = rankPlayers(room.players);
  const place = ranked.find((r) => r.player.id === room.you)?.rank;
  const headline = !room.participating ? 'Race finished' : place === 1 ? 'You won the race!' : `You finished ${ordinal(place ?? room.players.length)}`;
  const won = room.participating && place === 1;

  useEffect(() => {
    if (!room.participating) return;
    if (won) sfx.win();
    else sfx.sparkle();
  }, [room.participating, won]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Panel className="space-y-3 text-center">
        <div className={`text-4xl font-black ${won ? 'text-good-400' : 'text-ink-100'}`}>{headline}</div>
        {room.participating && <div className="text-sm text-ink-400">out of {room.players.length} players</div>}
        <div className="grid gap-2 sm:grid-cols-2">
          {host ? (
            <Button variant="primary" className="min-h-11" onClick={() => newClubRace()}>
              {Icons.retry('h-4 w-4')} New race
            </Button>
          ) : (
            <div className="flex min-h-11 items-center justify-center rounded-xl bg-ink-800/60 px-4 text-sm font-semibold text-ink-300" role="status">
              Waiting for the host…
            </div>
          )}
          <Button variant="ghost" className="min-h-11" onClick={leaveClub}>
            Leave room
          </Button>
        </div>
      </Panel>
      <Ranking room={room} players={room.players} />
    </div>
  );
}
