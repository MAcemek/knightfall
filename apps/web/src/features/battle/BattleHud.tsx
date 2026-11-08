import { useEffect, useRef, type RefObject } from 'react';
import { BATTLE_DURATION_MS, BATTLE_MAX_STRIKES, type BattleScore, type PlayerInfo } from '@knightfall/core';
import { sfx, TickerNumber } from '../../shared/fx/index.ts';
import { tugShare } from './battleState.ts';
import { formatClock, useNow } from './util.ts';

/**
 * Top bar: my score vs opponent score (big tickers + strike markers), the server-synced clock,
 * and a tug-of-war bar showing who is ahead.
 */
export function BattleHud({ me, opponent, myScore, oppScore, oppTick, endsAt, serverNow, live, myScoreRef }: {
  me: PlayerInfo;
  opponent: PlayerInfo;
  myScore: BattleScore;
  oppScore: BattleScore;
  oppTick: number;
  endsAt: number;
  serverNow: () => number;
  live: boolean;
  myScoreRef?: RefObject<HTMLDivElement | null>;
}) {
  useNow(200, live);
  const left = endsAt ? Math.max(0, endsAt - serverNow()) : BATTLE_DURATION_MS;
  const urgent = live && left > 0 && left <= 10_000;
  const secs = Math.ceil(left / 1000);

  // Tick every second in the final ten.
  const lastSec = useRef(secs);
  useEffect(() => {
    if (urgent && secs !== lastSec.current) sfx.tick();
    lastSec.current = secs;
  }, [secs, urgent]);

  // Subtle cue when the opponent scores / strikes.
  const prevOpp = useRef(oppScore);
  useEffect(() => {
    const p = prevOpp.current;
    prevOpp.current = oppScore;
    if (!oppTick) return;
    if (oppScore.solved > p.solved) sfx.click();
    else if (oppScore.strikes > p.strikes) sfx.tick();
  }, [oppTick, oppScore]);

  const share = tugShare(myScore.solved, oppScore.solved);
  const diff = myScore.solved - oppScore.solved;

  return (
    <div className="mb-3 rounded-2xl border border-ink-700/60 bg-ink-850 p-3 shadow-xl shadow-black/20 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <Side info={me} label="You" score={myScore} align="left" scoreRef={myScoreRef} />

        <div className="flex flex-col items-center">
          <div
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-2xl font-black tabular transition-colors sm:text-3xl ${
              urgent ? 'animate-pulse bg-bad-500/20 text-bad-400' : left === 0 && live ? 'bg-ink-800 text-ink-400' : 'bg-ink-800 text-ink-100'
            }`}
            aria-label="Time left"
          >
            {formatClock(left)}
          </div>
          <div className={`mt-1 text-[11px] font-bold uppercase tracking-wider ${diff > 0 ? 'text-good-400' : diff < 0 ? 'text-bad-400' : 'text-ink-400'}`}>
            {diff > 0 ? `Ahead by ${diff}` : diff < 0 ? `Behind by ${-diff}` : 'Level'}
          </div>
        </div>

        <Side info={opponent} label="Opponent" score={oppScore} align="right" />
      </div>

      {/* Tug of war */}
      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-sky-400/70" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Who is ahead">
        <div
          className="absolute inset-y-0 left-0 rounded-r-full bg-gradient-to-r from-ember-600 to-ember-400 shadow-[0_0_12px_rgb(255_154_31/0.7)] transition-[width] duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ width: `${share * 100}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-ink-950/60" />
      </div>
    </div>
  );
}

function Side({ info, label, score, align, scoreRef }: {
  info: PlayerInfo;
  label: string;
  score: BattleScore;
  align: 'left' | 'right';
  scoreRef?: RefObject<HTMLDivElement | null>;
}) {
  const right = align === 'right';
  const out = score.strikes >= BATTLE_MAX_STRIKES;
  const localScoreRef = useRef<HTMLDivElement>(null);
  const boxRef = scoreRef ?? localScoreRef;
  const strikesRef = useRef<HTMLDivElement>(null);
  const popKey = score.solved;
  const strikeKey = score.strikes;
  // Animate in place (no remount) so the ticker keeps counting smoothly.
  useEffect(() => {
    if (!popKey) return;
    boxRef.current?.animate?.(
      [{ transform: 'scale(1.45)', filter: 'brightness(1.6)' }, { transform: 'scale(1)', filter: 'brightness(1)' }],
      { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    );
  }, [popKey, boxRef]);
  useEffect(() => {
    if (!strikeKey) return;
    strikesRef.current?.animate?.(
      [0, -7, 7, -6, 6, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 420, easing: 'ease-out' },
    );
  }, [strikeKey]);
  return (
    // Narrow screens stack score over name/strikes so the strike row never collides with the clock.
    <div
      className={`flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3 ${
        right ? 'items-end text-right sm:flex-row-reverse' : 'items-start'
      }`}
    >
      <div
        ref={boxRef}
        className={`flex h-14 min-w-14 items-center justify-center rounded-xl px-2 font-mono text-4xl font-black sm:h-16 sm:min-w-16 sm:text-5xl ${
          right ? 'bg-sky-400/15 text-sky-400' : 'bg-ember-500/15 text-ember-400'
        } transition-opacity ${out ? 'opacity-50' : ''}`}
      >
        <TickerNumber value={score.solved} duration={0.35} />
      </div>
      <div className="w-full min-w-0 sm:w-auto">
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-400">{label}</div>
        <div className="truncate text-sm font-bold sm:text-base">{info.name}</div>
        <div ref={strikesRef} className={`mt-0.5 flex gap-1 ${right ? 'justify-end' : ''}`} aria-label={`${score.strikes} strikes`}>
          {Array.from({ length: BATTLE_MAX_STRIKES }, (_, i) => (
            <span
              key={i}
              className={`flex h-4 w-4 items-center justify-center rounded text-[10px] font-black transition-colors ${
                i < score.strikes ? 'bg-bad-500 text-white' : 'bg-ink-700 text-ink-500'
              }`}
            >
              ✗
            </span>
          ))}
          {out && <span className="ml-1 text-[10px] font-bold uppercase text-bad-400">Out</span>}
        </div>
      </div>
    </div>
  );
}
