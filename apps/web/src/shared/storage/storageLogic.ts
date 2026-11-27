/** Pure helpers for the "will the browser keep my data" line in Settings. */

export type StorageState = 'persisted' | 'best-effort';

export function storageState(persisted: boolean): StorageState {
  return persisted ? 'persisted' : 'best-effort';
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function storageLine(persisted: boolean, usage?: number, quota?: number): string {
  const head =
    storageState(persisted) === 'persisted'
      ? 'Storage: kept by the browser'
      : 'Storage: the browser may clear it when space runs low, keep backups';
  if (typeof usage === 'number' && typeof quota === 'number' && quota > 0) {
    return `${head}. ${formatBytes(usage)} used of ${formatBytes(quota)} available.`;
  }
  return `${head}.`;
}
