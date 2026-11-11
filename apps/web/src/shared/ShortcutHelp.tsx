import { Kbd, Modal } from './ui.tsx';

export interface ShortcutItem {
  /** Key caps, e.g. ['H'] or ['Enter', 'Space'] (alternatives) or ['←', '→']. */
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

/** Shortcuts every board understands (mouse). Append to a page's own groups. */
export const BOARD_SHORTCUTS: ShortcutGroup = {
  title: 'Board',
  items: [
    { keys: ['Click', 'Drag'], label: 'Move a piece' },
    { keys: ['Right-click'], label: 'Highlight a square' },
    { keys: ['Right-drag'], label: 'Draw an arrow' },
    { keys: ['Shift', 'Ctrl', 'Alt'], label: 'Hold while right-clicking for other colours' },
  ],
};

/** "Keyboard shortcuts" dialog. Open it from the "?" hotkey (see useHotkeysWithHelp). */
export function ShortcutHelp({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: ShortcutGroup[] }) {
  return (
    <Modal open={open} onClose={onClose} label="Keyboard shortcuts" size="md">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">Keyboard shortcuts</h2>
        <Kbd>?</Kbd>
      </div>
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">{g.title}</h3>
            <ul className="space-y-1.5">
              {g.items.map((it) => (
                <li key={it.label} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-ink-200">{it.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {it.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-5 text-xs text-ink-500">Press Esc to close.</p>
    </Modal>
  );
}
