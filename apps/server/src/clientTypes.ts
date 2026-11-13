import type { ClientMessage } from '@knightfall/core';

/**
 * Every message type a client may send. Written as a Record so that adding a variant to ClientMessage
 * without listing it here is a compile error (a missing 'claim' once made the server drop Battle claims).
 */
const TYPES: Record<ClientMessage['type'], true> = {
  queue: true,
  cancel: true,
  progress: true,
  rematch: true,
  leave: true,
  claim: true,
  ping: true,
};

export const CLIENT_TYPES: ReadonlySet<string> = new Set(Object.keys(TYPES));

export function isClientMessage(msg: { type: string } | null): msg is ClientMessage {
  return !!msg && CLIENT_TYPES.has(msg.type);
}
