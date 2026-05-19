import { useCallback, useSyncExternalStore } from 'react';

/** The server has no `matchMedia`; render the wide-viewport default there. */
const getServerSnapshot = (): boolean => false;

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 *
 * Built on `useSyncExternalStore` so it is SSR-safe (no hydration mismatch)
 * and re-renders only when the match state flips — not on every resize pixel.
 * The server has no `matchMedia`, so the server snapshot is always `false`
 * (a wide viewport — the app's desktop default).
 */
export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback((): boolean => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
