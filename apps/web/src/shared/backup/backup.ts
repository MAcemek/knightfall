import { db } from '../db.ts';
import { downloadJson } from '../download.ts';
import { BACKUP_TABLES, DEVICE_KEYS, backupFileName, buildBackup, type CleanBackup, type TableName } from './backupLogic.ts';

/** Dexie side of the progress backup. The rules and validation live in backupLogic.ts. */

/** Every table in one read transaction, so the file is a consistent snapshot. Returns JSON text. */
export async function createBackup(): Promise<string> {
  const tables = await db.transaction('r', db.tables, async () => {
    const out = {} as Record<TableName, unknown[]>;
    for (const name of BACKUP_TABLES) out[name] = await db.table(name).toArray();
    return out;
  });
  return JSON.stringify(buildBackup(tables, db.verno, new Date().toISOString()));
}

/** Download a backup of this device. Returns the file name. */
export async function saveBackup(): Promise<string> {
  const text = await createBackup();
  const name = backupFileName(new Date());
  downloadJson(name, text);
  return name;
}

/**
 * Replace everything on this device with a validated backup, in ONE transaction: any error aborts it and nothing changes.
 * This device's own battle code and token are kept, ratedPending is never restored.
 * When a later db.version(n) adds an upgrade() function, older backups must be migrated here too before they are written.
 */
export async function restoreBackup(clean: CleanBackup): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const own = (await db.kv.bulkGet([...DEVICE_KEYS.filter((k) => k !== 'ratedPending')])).filter((r) => r !== undefined);
    for (const name of BACKUP_TABLES) await db.table(name).clear();
    for (const name of BACKUP_TABLES) {
      if (clean.tables[name].length) await db.table(name).bulkAdd(clean.tables[name]);
    }
    if (own.length) await db.kv.bulkPut(own);
  });
}
