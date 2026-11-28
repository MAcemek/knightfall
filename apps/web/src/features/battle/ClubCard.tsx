import { Button, Icons, Panel } from '../../shared/ui.tsx';
import { createClub, useClub } from '../../shared/battle/clubStore.ts';
import type { FriendPrefs } from './friendSettings.ts';
import { SettingsDisclosure } from './SettingsControls.tsx';
import type { PrefsPatch } from './useFriendPrefs.ts';

/** "Host a club room" card in the Lobby (joining a room by code lives in the "Have a code?" card). */
export function ClubCard({ prefs, onPrefs }: { prefs: FriendPrefs; onPrefs: (patch: PrefsPatch) => void }) {
  const club = useClub();
  const busy = club.pending !== null;

  return (
    <Panel>
      <h2 className="text-sm font-bold uppercase tracking-wider text-ink-400">Host a club room</h2>
      <p className="mt-1 text-sm text-ink-300">Everyone races the same puzzles at once, with a live ranking.</p>
      <div className="mt-3">
        <SettingsDisclosure prefs={prefs} onChange={onPrefs} withSeries={false} label="Room settings" />
      </div>
      <Button className="mt-3 min-h-11" variant="primary" disabled={busy} onClick={() => void createClub(prefs.settings)}>
        {Icons.swords('h-4 w-4')} {club.pending === 'create' ? 'Creating…' : 'Create room'}
      </Button>
    </Panel>
  );
}
