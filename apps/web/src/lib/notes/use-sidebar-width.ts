import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'effi-notes:sidebar-width';
/** Same-tab notification — the native `storage` event only fires cross-tab. */
const CHANGE_EVENT = 'effi-notes:sidebar-width-change';

export const MIN_WIDTH = 380;
export const MAX_WIDTH = 720;
export const DEFAULT_WIDTH = 480;

/** Clamp a width into [MIN_WIDTH, MAX_WIDTH]; a non-finite value → DEFAULT_WIDTH. */
export const clampWidth = (n: number): number => {
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));
};

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

const getSnapshot = (): number => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_WIDTH;
    return clampWidth(Number(raw));
  } catch {
    return DEFAULT_WIDTH;
  }
};

/** The server has no localStorage — always render the default width there. */
const getServerSnapshot = (): number => DEFAULT_WIDTH;

/**
 * Sidebar width in px, persisted in localStorage so it survives reloads and
 * the per-route remount of NotesShell. `useSyncExternalStore` keeps it
 * SSR-safe (no hydration mismatch) without a setState-in-effect.
 *
 * Returns `[width, setWidth]`; `setWidth` clamps before persisting.
 */
export const useSidebarWidth = (): readonly [number, (n: number) => void] => {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setWidth = useCallback((n: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clampWidth(n)));
    } catch {
      // localStorage unavailable (private mode / quota) — skip persistence
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [width, setWidth] as const;
};
