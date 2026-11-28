import { useId, useState } from 'react';
import type { BattleLevel, BattleSettings } from '@knightfall/core';
import { Icons, Segmented } from '../../shared/ui.tsx';
import { DURATION_OPTIONS, LEVEL_OPTIONS, SERIES_OPTIONS, type FriendPrefs } from './friendSettings.ts';
import { settingsSummary } from './settingsSummary.ts';
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

/** A collapsed row ("Battle settings  3 min · Normal · Best of 1") that opens the pickers. */
export function SettingsDisclosure({ prefs, onChange, withSeries, disabled = false, label }: { prefs: FriendPrefs; onChange: (patch: PrefsPatch) => void; withSeries: boolean; disabled?: boolean; label: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-ink-800/60 px-3 text-left focus-visible:outline-2 focus-visible:outline-ember-400"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-ink-400">{label}</span>
          <span className="block truncate text-sm font-semibold text-ink-100">{settingsSummary(prefs, withSeries)}</span>
        </span>
        <span className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          {Icons.chevRight('h-4 w-4')}
        </span>
      </button>
      <div id={panelId} hidden={!open} className="mt-2">
        {open && <SettingsControls prefs={prefs} onChange={onChange} withSeries={withSeries} disabled={disabled} />}
      </div>
    </div>
  );
}
