import { CHECK_EVERY_MS, onControllerChange, shouldCheckOnVisible } from './updateLogic.ts';

/** Tiny store: true once a newer version has taken over and the page is still running the old code. */
let updateReady = false;
const listeners = new Set<() => void>();

export function subscribeUpdateReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getUpdateReady(): boolean {
  return updateReady;
}

function markUpdateReady(): void {
  if (updateReady) return;
  updateReady = true;
  listeners.forEach((fn) => fn());
}

/** Register the service worker (production builds only; `npm run dev` never has one). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let hadController = !!sw.controller;

  sw.addEventListener('controllerchange', () => {
    const next = onControllerChange(hadController);
    hadController = next.hadController;
    if (next.isUpdate) markUpdateReady();
  });

  window.addEventListener('load', () => {
    sw.register('/sw.js', { scope: '/' })
      .then((registration) => {
        watchWorkers(registration, () => hadController);
        scheduleChecks(registration);
      })
      .catch(() => {
        // Offline support is optional; the app works without it.
      });
  });
}

/** Defensive: a worker that waits instead of skipping ahead still counts once it activates. */
function watchWorkers(registration: ServiceWorkerRegistration, hasController: () => boolean): void {
  // Whether a worker is an update is decided when it starts installing: on a first visit the new worker claims the
  // page (so a controller appears) before it reports 'activated', and that first install must not count as an update.
  const watch = (worker: ServiceWorker | null, isUpdate: boolean) => {
    if (!worker || !isUpdate) return;
    const onState = () => {
      if (worker.state === 'activated') markUpdateReady();
    };
    worker.addEventListener('statechange', onState);
    onState();
  };
  watch(registration.waiting, hasController());
  registration.addEventListener('updatefound', () => watch(registration.installing, hasController()));
}

function scheduleChecks(registration: ServiceWorkerRegistration): void {
  let last = Date.now();
  const check = () => {
    last = Date.now();
    registration.update().catch(() => {
      // Offline or a flaky network: try again at the next trigger.
    });
  };
  window.setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && shouldCheckOnVisible(Date.now(), last)) check();
  });
  window.addEventListener('online', check);
}
