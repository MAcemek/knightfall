import { storageLine } from './storageLogic.ts';

/** Ask the browser not to evict this site's data. Never throws. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    const s = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!s?.persist) return;
    if (s.persisted && (await s.persisted())) return;
    await s.persist();
  } catch {
    /* best effort */
  }
}

/** The one-line status for Settings. Never throws. */
export async function readStorageLine(): Promise<string> {
  let persisted = false;
  let usage: number | undefined;
  let quota: number | undefined;
  try {
    const s = navigator.storage;
    if (s?.persisted) persisted = await s.persisted();
    if (s?.estimate) {
      const e = await s.estimate();
      usage = e.usage;
      quota = e.quota;
    }
  } catch {
    /* show what we have */
  }
  return storageLine(persisted, usage, quota);
}
