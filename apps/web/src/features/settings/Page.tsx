import { useEffect, useState } from 'react';
import { readStorageLine } from '../../shared/storage/persist.ts';
import { Board } from '../../shared/Board/index.ts';
import { sfx } from '../../shared/fx/index.ts';
import { useInstall } from '../../shared/pwa/install.ts';
import { setPlayerName, useProfile } from '../../shared/profile.ts';
import { resetSettings, setSetting, useSettings } from '../../shared/settings.ts';
import { ANIM_SPEEDS, BOARD_THEMES, DAILY_GOALS, SELF_REVIEW_MODES, type DailyGoal } from '../../shared/settingsLogic.ts';
import { toast } from '../../shared/toast.tsx';
import { Button, Icons, PageHeader, Panel, Segmented, Switch } from '../../shared/ui.tsx';
import { BackupPanel } from './BackupPanel.tsx';

type DailyGoalId = `${(typeof DAILY_GOALS)[number]}`;
const DAILY_GOAL_OPTIONS: readonly { id: DailyGoalId; label: string }[] = DAILY_GOALS.map((g) => ({
  id: String(g) as DailyGoalId,
  label: g === 0 ? 'Off' : String(g),
}));

export default function SettingsPage() {
  const s = useSettings();
  const profile = useProfile();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const { view: installState, install } = useInstall();
  const [storage, setStorage] = useState('');

  useEffect(() => {
    void readStorageLine().then(setStorage);
  }, []);

  useEffect(() => {
    if (profile) setName(profile.name);
  }, [profile?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveName = async () => {
    const ok = await setPlayerName(name);
    if (ok) {
      setNameError('');
      setName(ok);
      toast({ title: 'Name saved', body: ok, icon: 'check', tone: 'good' });
    } else {
      setNameError('Use 2 to 20 characters.');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Settings" subtitle="Sound, board, animations and backup" icon={Icons.sliders('h-6 w-6')} />

      <div className="animate-rise">
        <Panel className="space-y-4">
          <h2 className="text-lg font-extrabold">Profile</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              maxLength={20}
              aria-label="Player name"
              onChange={(e) => {
                setName(e.target.value);
                setNameError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveName();
              }}
              className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-3 font-semibold text-ink-100 outline-none focus:border-ember-400"
            />
            <Button onClick={() => void saveName()}>Save</Button>
          </div>
          {nameError ? (
            <p className="text-sm text-bad-400" role="alert">
              {nameError}
            </p>
          ) : (
            <p className="text-sm text-ink-400">Shown to your opponent in Battle.</p>
          )}
        </Panel>
      </div>

      <div className="animate-rise" style={{ animationDelay: '40ms' }}>
        <Panel className="space-y-4">
          <h2 className="text-lg font-extrabold">Sound</h2>
          <Switch checked={s.sound} onChange={(v) => setSetting('sound', v)} label="Sound effects" />
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(s.volume * 100)}
              disabled={!s.sound}
              onChange={(e) => setSetting('volume', Number(e.target.value) / 100)}
              onPointerUp={() => sfx.correct()}
              onKeyUp={() => sfx.correct()}
              aria-label="Volume"
              className="w-full accent-ember-500 disabled:opacity-40"
            />
            <span className="w-12 text-right font-mono text-sm">{Math.round(s.volume * 100)}%</span>
          </div>
          <Switch
            checked={s.vibration}
            onChange={(v) => setSetting('vibration', v)}
            label="Vibration"
            hint="Short buzz on right and wrong moves. Android phones only, iPhones do not support it."
          />
          <div className="font-semibold">Daily goal</div>
          <Segmented
            label="Daily goal"
            options={DAILY_GOAL_OPTIONS}
            value={String(s.dailyGoal) as DailyGoalId}
            onChange={(v) => setSetting('dailyGoal', Number(v) as DailyGoal)}
          />
          <p className="text-sm text-ink-400">Puzzles to solve each day, shown as a ring on Home.</p>
        </Panel>
      </div>

      <div className="animate-rise" style={{ animationDelay: '80ms' }}>
        <Panel className="space-y-4">
          <h2 className="text-lg font-extrabold">Board</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BOARD_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={s.boardTheme === t.id}
                onClick={() => {
                  sfx.click();
                  setSetting('boardTheme', t.id);
                }}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-colors ${s.boardTheme === t.id ? 'border-ember-400 bg-ink-800' : 'border-ink-700 hover:border-ink-500'}`}
              >
                <div className="grid h-14 w-14 grid-cols-2 overflow-hidden rounded-lg">
                  {[t.light, t.dark, t.dark, t.light].map((c, i) => (
                    <div key={i} style={{ background: c }} />
                  ))}
                </div>
                <span className="text-sm font-bold">{t.label}</span>
              </button>
            ))}
          </div>
          <Switch checked={s.showCoords} onChange={(v) => setSetting('showCoords', v)} label="Show coordinates" hint="Rank and file labels on the board edge." />
          <div className="mx-auto w-full max-w-[280px]">
            <Board fen="r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5" lastMove={['f8', 'c5']} />
          </div>
        </Panel>
      </div>

      <div className="animate-rise" style={{ animationDelay: '120ms' }}>
        <Panel className="space-y-4">
          <h2 className="text-lg font-extrabold">Animations</h2>
          <Segmented label="Animation speed" options={ANIM_SPEEDS} value={s.animSpeed} onChange={(v) => setSetting('animSpeed', v)} />
          <p className="text-sm text-ink-400">
            Fast shortens effects; Off removes them. Game speed, timers and premoves are never affected. Your system&apos;s reduce-motion preference always wins.
          </p>
        </Panel>
      </div>

      <div className="animate-rise" style={{ animationDelay: '160ms' }}>
        <Panel className="space-y-4">
          <h2 className="text-lg font-extrabold">Puzzles</h2>
          <Switch checked={s.autoAdvance} onChange={(v) => setSetting('autoAdvance', v)} label="Auto-advance" hint="Load the next rated puzzle automatically after a solve." />
          <Switch checked={s.premoves} onChange={(v) => setSetting('premoves', v)} label="Premoves" hint="Queue your next move while the opponent is moving." />
          <Switch
            checked={s.autoGamePuzzles}
            onChange={(v) => setSetting('autoGamePuzzles', v)}
            label="Add mistakes from my analysed games to Train"
            hint="After a Game Review finishes, your blunders and misses become puzzles in Train, From my games."
          />
        </Panel>
      </div>

      <div className="animate-rise" style={{ animationDelay: '180ms' }}>
        <Panel className="space-y-4">
          <h2 className="text-lg font-extrabold">Game Review</h2>
          <Segmented label="Review a game yourself first" options={SELF_REVIEW_MODES} value={s.selfReview} onChange={(v) => setSetting('selfReview', v)} />
          <p className="text-sm text-ink-400">Before Stockfish runs, mark where the game turned yourself. Slow games are rapid, Daily, classical and bot games.</p>
        </Panel>
      </div>

      <div className="animate-rise" style={{ animationDelay: '200ms' }}>
        <BackupPanel />
        {storage && <p className="mt-2 px-1 text-sm text-ink-400">{storage}</p>}
      </div>

      {installState !== 'none' && (
        <div className="animate-rise" style={{ animationDelay: '240ms' }}>
          <Panel className="space-y-4">
            <h2 className="text-lg font-extrabold">Install Knightfall</h2>
            {installState === 'prompt' && (
              <>
                <p className="text-sm text-ink-400">Add Knightfall to your device to open it like an app. Puzzles and saved reviews work offline.</p>
                <Button onClick={() => void install()}>Install Knightfall</Button>
              </>
            )}
            {installState === 'installed' && <p className="text-sm font-semibold text-ink-200">Installed</p>}
            {installState === 'ios-hint' && <p className="text-sm text-ink-400">To install on iPhone or iPad: Share → Add to Home Screen.</p>}
          </Panel>
        </div>
      )}

      <Button
        variant="ghost"
        onClick={() => {
          resetSettings();
          toast({ title: 'Settings reset', icon: 'sliders', tone: 'sky' });
        }}
      >
        Reset to defaults
      </Button>
    </div>
  );
}
