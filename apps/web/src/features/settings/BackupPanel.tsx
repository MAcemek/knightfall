import { useEffect, useRef, useState } from 'react';
import { deviceCounts, restoreBackup, saveBackup, type DeviceCounts } from '../../shared/backup/backup.ts';
import { MAX_BACKUP_BYTES, parseBackup, type BackupSummary, type CleanBackup } from '../../shared/backup/backupLogic.ts';
import { useBackupReminder } from '../../shared/backup/useBackupReminder.ts';
import { db } from '../../shared/db.ts';
import { toast } from '../../shared/toast.tsx';
import { Button, Modal, Panel } from '../../shared/ui.tsx';

interface Pending {
  backup: CleanBackup;
  summary: BackupSummary;
  device: DeviceCounts | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an unknown date' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function BackupPanel() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const reminder = useBackupReminder();

  useEffect(() => {
    if (window.location.hash === '#backup') document.getElementById('backup')?.scrollIntoView({ block: 'start' });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('restored') !== '1') return;
    toast({ title: 'Progress restored', icon: 'check', tone: 'good' });
    params.delete('restored');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const name = await saveBackup();
      toast({ title: 'Backup saved', body: name, icon: 'check', tone: 'good' });
    } catch {
      setError('Could not save the backup.');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setError('');
    if (file.size > MAX_BACKUP_BYTES) {
      setError('That file is too large to be a Knightfall backup.');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError('Could not read that file.');
      return;
    }
    const r = parseBackup(text, db.verno);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRestoreError('');
    let device: DeviceCounts | null = null;
    try {
      device = await deviceCounts();
    } catch {
      /* the confirmation just shows the file's numbers */
    }
    setPending({ backup: r.backup, summary: r.summary, device });
  };

  const replace = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setRestoreError('');
    try {
      // Safety copy of what is on this device now. If it cannot be made, nothing is replaced.
      await saveBackup();
    } catch {
      setRestoreError('Could not save a backup of this device first, so nothing was replaced.');
      setBusy(false);
      return;
    }
    try {
      await restoreBackup(pending.backup);
    } catch {
      setRestoreError('Restore failed. Nothing was changed.');
      setBusy(false);
      return;
    }
    // A full page load: settings, sound and the battle connection hold in-memory copies of the old data.
    window.location.assign('/settings?restored=1');
  };

  const saveFirst = async () => {
    setBusy(true);
    try {
      const name = await saveBackup();
      toast({ title: 'Backup saved', body: name, icon: 'check', tone: 'good' });
    } catch {
      setRestoreError('Could not save a backup of this device.');
    } finally {
      setBusy(false);
    }
  };

  const s = pending?.summary;
  const d = pending?.device;

  return (
    <div id="backup">
      <Panel className="space-y-4">
        <h2 className="text-lg font-extrabold">Backup</h2>
        {reminder && (
          <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-3 py-2 text-sm font-semibold text-ember-300" role="status">
            {reminder} Press Save backup to keep a copy.
          </p>
        )}
        <p className="text-sm text-ink-400">Your progress is stored only in this browser. Save a backup file to keep it safe or move it to another device.</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            Save backup
          </Button>
          <Button disabled={busy} onClick={() => fileInput.current?.click()}>
            Restore backup
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Backup file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {error && (
          <p className="text-sm text-bad-400" role="alert">
            {error}
          </p>
        )}
      </Panel>

      <Modal open={!!pending} onClose={busy ? undefined : () => setPending(null)} label="Replace all progress">
        <h2 className="text-lg font-extrabold">Replace all progress on this device?</h2>
        {s && (
          <div className="mt-3 text-sm text-ink-200">
            <p>Backup file, made on {formatDate(s.exportedAt)}</p>
            <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1">
              <span />
              <span className="text-xs font-bold uppercase tracking-wider text-ink-400">This device</span>
              <span className="text-xs font-bold uppercase tracking-wider text-ink-400">Backup file</span>
              {[
                ['Player', d?.playerName ?? '-', s.playerName ?? '-'],
                ['Puzzle rating', d?.rating ?? '-', s.puzzleRating ?? '-'],
                ['Puzzles tried', d?.attempts ?? '-', s.attempts],
                ['Battles', d?.battles ?? '-', s.battles],
                ['Games', d?.games ?? '-', s.games],
                ['Custom puzzles', d?.customPuzzles ?? '-', s.customPuzzles],
              ].map(([label, now, then]) => (
                <div key={label} className="contents">
                  <span>{label}</span>
                  <span className="font-mono">{now}</span>
                  <span className="font-mono">{then}</span>
                </div>
              ))}
            </div>
            {d && d.attempts > s.attempts && <p className="mt-2 font-semibold text-ember-300">This device has more puzzles than the backup file.</p>}
            {s.skipped > 0 && <p className="mt-2 text-ink-400">{plural(s.skipped, 'damaged entry', 'damaged entries')} will be skipped</p>}
          </div>
        )}
        <p className="mt-3 text-sm font-semibold text-bad-400">Everything stored on this device now will be replaced. A backup of this device is downloaded first.</p>
        {restoreError && (
          <p className="mt-3 text-sm font-semibold text-bad-400" role="alert">
            {restoreError}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button disabled={busy} onClick={() => void saveFirst()}>
            Save a backup of this device first
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void replace()}>
            {busy ? 'Working...' : 'Replace progress'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
