import { useEffect, useState } from 'react';
import { parseOpeningData, type OpeningData } from './openingLogic.ts';

let cache: Promise<OpeningData | null> | null = null;

/** public/opening-lines.json, fetched once. Null when it cannot be loaded. */
function loadOpeningData(): Promise<OpeningData | null> {
  cache ??= fetch('/opening-lines.json')
    .then((r) => (r.ok ? r.json() : null))
    .then(parseOpeningData)
    .catch(() => null);
  return cache;
}

export type OpeningDataState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: OpeningData };

export function useOpeningData(): OpeningDataState {
  const [state, setState] = useState<OpeningDataState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    void loadOpeningData().then((data) => {
      if (!live) return;
      setState(data ? { status: 'ready', data } : { status: 'error' });
      if (!data) cache = null; // let a later visit try again
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
