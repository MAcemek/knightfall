import type { PlayerInfo, ServerMessage } from '@knightfall/core';

/** Anyone who can sit in a battle room: a connected human or a server-side bot. */
export interface Participant {
  readonly id: string;
  readonly isBot: boolean;
  info: PlayerInfo;
  send(msg: ServerMessage): void;
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1e9;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Sanitize a client-supplied PlayerInfo. Returns null when it is unusable. */
export function sanitizePlayer(raw: unknown): PlayerInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const { name, rating } = raw as { name?: unknown; rating?: unknown };
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return null;
  const cleanName =
    typeof name === 'string'
      ? name
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, 24)
      : '';
  return { name: cleanName || 'Anonymous', rating: Math.round(clamp(rating, 100, 3500)) };
}
