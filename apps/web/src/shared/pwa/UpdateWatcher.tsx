import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from '../toast.tsx';
import { getUpdateReady, subscribeUpdateReady } from './register.ts';
import { isAnalysisRunning } from '../analysis/busy.ts';
import { claimReload, decideOnUpdate, handlePreloadError, isTypingTarget, shouldReloadOnReturn } from './updateLogic.ts';

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function reloadOnce(): void {
  if (claimReload(session(), Date.now())) window.location.reload();
}

/** Switches the open page to a newly deployed version, but never in the middle of something. */
export function UpdateWatcher() {
  const ready = useSyncExternalStore(subscribeUpdateReady, getUpdateReady, () => false);
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const deferredAt = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (deferredAt.current === null) {
      if (decideOnUpdate(pathname, isTypingTarget(document.activeElement), isAnalysisRunning()) === 'reload') {
        reloadOnce();
        return;
      }
      deferredAt.current = pathname;
      toast({
        title: 'Knightfall was updated',
        body: 'Reload to get the new version',
        icon: 'bolt',
        tone: 'sky',
        durationMs: 20000,
        // The player asked for it: no guard, a click cannot loop.
        onClick: () => window.location.reload(),
      });
    } else if (pathname !== deferredAt.current) {
      deferredAt.current = pathname;
      if (decideOnUpdate(pathname, isTypingTarget(document.activeElement), isAnalysisRunning()) === 'reload') reloadOnce();
    }
  }, [ready, pathname]);

  useEffect(() => {
    if (!ready) return;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && shouldReloadOnReturn(Date.now() - hiddenAt, pathRef.current, isTypingTarget(document.activeElement), isAnalysisRunning())) {
        reloadOnce();
      }
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [ready]);

  // A deploy can remove the page chunks of the build this tab runs: the next lazy page then fails to load.
  useEffect(() => {
    const onPreloadError = (event: Event) => {
      handlePreloadError(event, session(), Date.now(), () => window.location.reload());
    };
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => window.removeEventListener('vite:preloadError', onPreloadError);
  }, []);

  return null;
}
