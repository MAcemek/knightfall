import { useSyncExternalStore } from 'react';
import { isReaction, REACTION_COOLDOWN_MS, type ReactionId } from '@knightfall/core';
import * as conn from './connection.ts';
import { serverSupports } from './connectionLogic.ts';

/**
 * Quick reactions on the end screens. Incoming ones (and my own, for feedback) live here for a few seconds;
 * the socket is watched from this module so nothing in store.ts or clubStore.ts has to forward them.
 */

export interface ReactionItem {
  id: number;
  reaction: ReactionId;
  /** The sender's display name, or null for my own. */
  from: string | null;
  at: number;
}

export const REACTION_TTL_MS = 3500;

/** Pure: may a reaction be sent now? */
export function cooldownPassed(now: number, lastSentAt: number | null, cooldownMs: number = REACTION_COOLDOWN_MS): boolean {
  return lastSentAt === null || now - lastSentAt >= cooldownMs;
}

/** Pure: drop reactions older than the lifetime (returns the same array when nothing expired). */
export function pruneReactions(list: readonly ReactionItem[], now: number, ttlMs: number = REACTION_TTL_MS): readonly ReactionItem[] {
  const kept = list.filter((r) => now - r.at < ttlMs);
  return kept.length === list.length ? list : kept;
}

/** Pure: the reaction and sender of a raw `reaction` message, or null when the message is not a valid reaction. */
export function incomingReaction(msg: { type: string; reaction?: unknown; from?: unknown }): { reaction: ReactionId; from: string } | null {
  if (msg.type !== 'reaction' || !isReaction(msg.reaction)) return null;
  const from = typeof msg.from === 'string' && msg.from.trim() ? msg.from.trim().slice(0, 40) : 'Opponent';
  return { reaction: msg.reaction, from };
}

let items: readonly ReactionItem[] = [];
let lastSentAt: number | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

function add(reaction: ReactionId, from: string | null): void {
  const item: ReactionItem = { id: nextId++, reaction, from, at: Date.now() };
  items = [...items, item].slice(-8);
  setTimeout(() => {
    const next = pruneReactions(items, Date.now());
    if (next === items) return;
    items = next;
    emit();
  }, REACTION_TTL_MS + 20);
  emit();
}

conn.subscribe((ev) => {
  if (ev.type !== 'message') return;
  const r = incomingReaction(ev.msg);
  if (r) add(r.reaction, r.from);
});

export const getReactions = (): readonly ReactionItem[] => items;
export const getLastSentAt = (): number | null => lastSentAt;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useReactions(): readonly ReactionItem[] {
  return useSyncExternalStore(subscribe, getReactions, getReactions);
}

export function useLastSentAt(): number | null {
  return useSyncExternalStore(subscribe, getLastSentAt, getLastSentAt);
}

/** Send a reaction when the server supports it and my cooldown is over. Returns whether it went out. */
export function sendReaction(reaction: ReactionId): boolean {
  if (!serverSupports(conn.getSnapshot().serverCaps, 'react')) return false;
  const now = Date.now();
  if (!cooldownPassed(now, lastSentAt)) return false;
  if (!conn.send({ type: 'react', reaction })) return false;
  lastSentAt = now;
  add(reaction, null);
  return true;
}
