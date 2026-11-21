// Install-prompt state for the "Install Knightfall" section in Settings. Pure logic, no DOM access.

/** The non-standard event Chromium fires when the app is installable. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export interface InstallState {
  /** The deferred browser prompt, when one is available. */
  deferred: InstallPromptEvent | null;
  /** Running as an installed app (display-mode: standalone). */
  installed: boolean;
}

export const INITIAL_INSTALL_STATE: InstallState = { deferred: null, installed: false };

export type InstallAction =
  | { type: 'prompt-available'; event: InstallPromptEvent }
  | { type: 'prompt-used' }
  | { type: 'installed' }
  | { type: 'standalone'; value: boolean };

export function installReducer(state: InstallState, action: InstallAction): InstallState {
  switch (action.type) {
    case 'prompt-available':
      return state.installed ? state : { ...state, deferred: action.event };
    case 'prompt-used':
      // A deferred prompt can only be shown once.
      return { ...state, deferred: null };
    case 'installed':
      return { deferred: null, installed: true };
    case 'standalone':
      return action.value ? { deferred: null, installed: true } : { ...state, installed: false };
  }
}

/** iPhone/iPad Safari (other iOS browsers cannot add to the home screen the same way). */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent) && /Safari/.test(userAgent);
}

/** What the Settings section should show. */
export type InstallView = 'installed' | 'prompt' | 'ios-hint' | 'none';

export function installView(state: InstallState, iosSafari: boolean): InstallView {
  if (state.installed) return 'installed';
  if (state.deferred) return 'prompt';
  if (iosSafari) return 'ios-hint';
  return 'none';
}
