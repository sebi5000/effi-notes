import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'effi-notes:doc-panel-open';
/** Same-tab notification — the native `storage` event only fires cross-tab. */
const CHANGE_EVENT = 'effi-notes:doc-panel-change';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

/** Absent or `'true'` → open; only an explicit `'false'` closes the panel. */
const getSnapshot = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

/** The server has no localStorage — render open there. */
const getServerSnapshot = (): boolean => true;

/**
 * Document-panel open/closed state, persisted in localStorage so it survives
 * reloads and the per-note remount of the editor. `useSyncExternalStore`
 * keeps it SSR-safe. Returns `[open, toggle]`.
 */
export const useDocPanel = (): readonly [boolean, () => void] => {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage unavailable (private mode / quota) — skip persistence
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [open, toggle] as const;
};
