import { useCallback, useEffect, useReducer } from 'react';
import { INITIAL_INSTALL_STATE, installReducer, installView, isIosSafari, type InstallPromptEvent, type InstallView } from './installLogic.ts';

const standaloneQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null);

function isStandalone(): boolean {
  const iosStandalone = typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || (standaloneQuery()?.matches ?? false);
}

/** Install-prompt state for the Settings page. */
export function useInstall(): { view: InstallView; install: () => Promise<void> } {
  const [state, dispatch] = useReducer(installReducer, INITIAL_INSTALL_STATE, (s) => ({ ...s, installed: isStandalone() }));

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      dispatch({ type: 'prompt-available', event: e as InstallPromptEvent });
    };
    const onInstalled = () => dispatch({ type: 'installed' });
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const mq = standaloneQuery();
    const onMode = () => dispatch({ type: 'standalone', value: isStandalone() });
    mq?.addEventListener('change', onMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener('change', onMode);
    };
  }, []);

  const install = useCallback(async () => {
    const ev = state.deferred;
    if (!ev) return;
    dispatch({ type: 'prompt-used' });
    await ev.prompt();
    await ev.userChoice;
  }, [state.deferred]);

  const ios = typeof navigator !== 'undefined' && isIosSafari(navigator.userAgent, navigator.maxTouchPoints);
  return { view: installView(state, ios), install };
}
