import { useEffect, useRef } from 'react';

/**
 * A single full-screen canvas for particle bursts and confetti.
 * Mount <FxLayer/> once (App does this), then call burst()/confetti() from anywhere.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  shape: 'dot' | 'rect' | 'star';
  rot: number;
  vr: number;
  gravity: number;
}

const particles: Particle[] = [];
let running = false;
let canvasEl: HTMLCanvasElement | null = null;

export const PALETTES = {
  good: ['#5be38e', '#2fcf6f', '#b8ffd2', '#ffffff'],
  ember: ['#ffb454', '#ff9a1f', '#ffcf8a', '#fff2d6'],
  bad: ['#ff7a7a', '#f04848', '#ffd0d0'],
  party: ['#ffb454', '#5be38e', '#6cc4ff', '#b48cff', '#ff7a7a', '#ffffff'],
};

export interface BurstOptions {
  count?: number;
  colors?: string[];
  power?: number;
  spread?: number; // radians, full circle by default
  angle?: number; // center direction (radians); -PI/2 = up
  gravity?: number;
  size?: number;
  shape?: Particle['shape'];
  life?: number; // frames
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Explode particles from a viewport point. */
export function burst(x: number, y: number, o: BurstOptions = {}) {
  if (reducedMotion()) return;
  const { count = 26, colors = PALETTES.ember, power = 7, spread = Math.PI * 2, angle = -Math.PI / 2, gravity = 0.22, size = 5, shape, life = 60 } = o;
  for (let i = 0; i < count; i++) {
    const a = angle - spread / 2 + Math.random() * spread;
    const p = power * (0.45 + Math.random() * 0.75);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * p,
      vy: Math.sin(a) * p,
      life: 0,
      max: life * (0.7 + Math.random() * 0.6),
      size: size * (0.6 + Math.random() * 0.8),
      color: colors[(Math.random() * colors.length) | 0],
      shape: shape ?? (Math.random() < 0.5 ? 'dot' : 'rect'),
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      gravity,
    });
  }
  start();
}

/** Burst centered on a DOM element (e.g. a board square or a score badge). */
export function burstAt(el: Element | null | undefined, o: BurstOptions = {}) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, o);
}

/** Big celebratory confetti from both bottom corners. */
export function confetti(o: { count?: number; colors?: string[] } = {}) {
  const { count = 90, colors = PALETTES.party } = o;
  const h = window.innerHeight;
  const w = window.innerWidth;
  burst(0, h, { count: count / 2, colors, power: 17, angle: -Math.PI / 3, spread: 0.7, gravity: 0.32, size: 7, life: 120, shape: 'rect' });
  burst(w, h, { count: count / 2, colors, power: 17, angle: (-2 * Math.PI) / 3, spread: 0.7, gravity: 0.32, size: 7, life: 120, shape: 'rect' });
}

function start() {
  if (running || !canvasEl) return;
  running = true;
  requestAnimationFrame(frame);
}

function frame() {
  const c = canvasEl;
  if (!c) {
    running = false;
    return;
  }
  const ctx = c.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, c.width / dpr, c.height / dpr);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life++;
    p.vy += p.gravity;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    const t = p.life / p.max;
    if (t >= 1) {
      particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = 1 - t * t;
    ctx.fillStyle = p.color;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.shape === 'dot') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.shape === 'rect') {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    } else {
      drawStar(ctx, p.size);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (particles.length) requestAnimationFrame(frame);
  else running = false;
}

function drawStar(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.25 : s * 0.6;
    const a = (i * Math.PI) / 5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

export function FxLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    canvasEl = c;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      c.width = window.innerWidth * dpr;
      c.height = window.innerHeight * dpr;
      c.style.width = `${window.innerWidth}px`;
      c.style.height = `${window.innerHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      canvasEl = null;
    };
  }, []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[100]" aria-hidden />;
}
