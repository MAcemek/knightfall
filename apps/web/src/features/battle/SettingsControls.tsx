import type { BattleLevel, BattleSettings } from '@knightfall/core';
import { Segmented } from '../../shared/ui.tsx';
import { DURATION_OPTIONS, LEVEL_OPTIONS, SERIES_OPTIONS, type FriendPrefs } from './friendSettings.ts';
import type { PrefsPatch } from './useFriendPrefs.ts';

/** Time / difficulty (and, for friend battles, best-of) pickers. Wraps on phones. */
export function SettingsControls({ prefs, onChange, withSeries, disabled = false }: { prefs: FriendPrefs; onChange: (patch: PrefsPatch) => void; withSeries: boolean; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className={`m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0 ${disabled ? 'opacity-50' : ''}`}>
      <Segmented
        label="Time"
        options={DURATION_OPTIONS}
        value={String(prefs.settings.durationMs) as (typeof DURATION_OPTIONS)[number]['id']}
        onChange={(v) => onChange({ settings: { durationMs: Number(v) as BattleSettings['durationMs'] } })}
      />
      <Segmented label="Difficulty" options={LEVEL_OPTIONS} value={prefs.settings.level} onChange={(v) => onChange({ settings: { level: v as BattleLevel } })} />
      {withSeries && (
        <Segmented label="Series" options={SERIES_OPTIONS} value={String(prefs.series) as '1' | '3'} onChange={(v) => onChange({ series: v === '3' ? 3 : 1 })} />
      )}
    </fieldset>
  );
}
