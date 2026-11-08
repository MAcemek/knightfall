/**
 * Synthesized sound effects (Web Audio API). No audio files, so nothing to license.
 * Usage: import { sfx } from '@/shared/fx/sound'; sfx.correct();
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem('kf:muted') === '1';
  } catch {
    return false;
  }
}

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function out(): AudioNode {
  return master!;
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.25, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** A short tonal note with an exponential decay envelope. */
function tone(freq: number, opts: { type?: OscillatorType; dur?: number; gain?: number; delay?: number; glideTo?: number } = {}) {
  const c = ac();
  if (!c) return;
  const { type = 'triangle', dur = 0.25, gain = 0.35, delay = 0, glideTo } = opts;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out());
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Woody "tock": filtered noise burst + low body thump. */
function knock(opts: { freq?: number; body?: number; gain?: number; delay?: number } = {}) {
  const c = ac();
  if (!c) return;
  const { freq = 1900, body = 170, gain = 0.5, delay = 0 } = opts;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  src.connect(bp).connect(g).connect(out());
  src.start(t);
  src.stop(t + 0.08);
  tone(body, { type: 'sine', dur: 0.09, gain: gain * 0.7, delay, glideTo: body * 0.6 });
}

const semis = (base: number, n: number) => base * Math.pow(2, n / 12);

export const sfx = {
  move() {
    knock();
  },
  capture() {
    knock({ freq: 1300, body: 120, gain: 0.7 });
    knock({ freq: 2600, body: 200, gain: 0.35, delay: 0.035 });
  },
  check() {
    knock();
    tone(1318.5, { type: 'sine', dur: 0.18, gain: 0.18, delay: 0.03 });
  },
  castle() {
    knock();
    knock({ delay: 0.09, gain: 0.4 });
  },
  promote() {
    knock();
    tone(784, { dur: 0.15, gain: 0.2, delay: 0.04 });
    tone(1175, { dur: 0.22, gain: 0.2, delay: 0.1 });
  },
  /** A correct solver move. */
  correct() {
    tone(1318.5, { dur: 0.16, gain: 0.22 });
    tone(1975.5, { dur: 0.26, gain: 0.2, delay: 0.06 });
  },
  /** A wrong solver move: dull low bonk. */
  wrong() {
    tone(196, { type: 'square', dur: 0.2, gain: 0.12, glideTo: 130 });
    tone(98, { type: 'sine', dur: 0.28, gain: 0.35, glideTo: 70 });
  },
  /** Puzzle fully solved: bright rising arpeggio. */
  solved() {
    [0, 4, 7, 12].forEach((s, i) => tone(semis(784, s), { dur: 0.32, gain: 0.2, delay: i * 0.065 }));
  },
  /** Combo chime whose pitch climbs with the streak (capped at two octaves). */
  combo(n: number) {
    const s = Math.min(24, Math.max(0, n - 1) * 2);
    tone(semis(659.3, s), { dur: 0.2, gain: 0.2 });
    tone(semis(987.8, s), { dur: 0.3, gain: 0.16, delay: 0.05 });
  },
  /** Milestone sparkle (every 5/10 streak). */
  sparkle() {
    [0, 7, 12, 19, 24].forEach((s, i) => tone(semis(1046.5, s), { type: 'sine', dur: 0.25, gain: 0.12, delay: i * 0.045 }));
  },
  tick() {
    tone(2200, { type: 'square', dur: 0.03, gain: 0.05 });
  },
  countdown() {
    tone(660, { type: 'square', dur: 0.12, gain: 0.1 });
  },
  go() {
    tone(1320, { type: 'square', dur: 0.25, gain: 0.12 });
  },
  win() {
    [0, 4, 7, 12, 16].forEach((s, i) => tone(semis(523.3, s), { dur: 0.4, gain: 0.2, delay: i * 0.09 }));
  },
  lose() {
    [7, 3, 0, -5].forEach((s, i) => tone(semis(392, s), { dur: 0.35, gain: 0.18, delay: i * 0.12 }));
  },
  strike() {
    tone(150, { type: 'sawtooth', dur: 0.25, gain: 0.12, glideTo: 90 });
  },
  click() {
    tone(1500, { type: 'sine', dur: 0.04, gain: 0.08 });
  },
};

export function isMuted() {
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem('kf:muted', v ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (v && ctx) {
    void ctx.close();
    ctx = null;
    master = null;
    noiseBuf = null;
  }
}
