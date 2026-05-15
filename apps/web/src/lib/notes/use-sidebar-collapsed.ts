import { useCallback, useEffect, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'effi-notes:sidebar-collapsed';
/** Same-tab notification — the native `storage` event only fires cross-tab. */
const CHANGE_EVENT = 'effi-notes:sidebar-collapsed-change';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

const getSnapshot = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

/** The server has no localStorage — always render expanded there. */
const getServerSnapshot = (): boolean => false;

/**
 * Sidebar collapsed state, persisted in localStorage so it survives reloads
 * and the per-route remount of NotesShell. `useSyncExternalStore` keeps it
 * SSR-safe (no hydration mismatch) without a setState-in-effect. Also
 * toggled by Cmd/Ctrl+\.
 *
 * Returns `[collapsed, toggle]`.
 */
export const useSidebarCollapsed = (): readonly [boolean, () => void] => {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage unavailable (private mode / quota) — skip persistence
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return [collapsed, toggle] as const;
};
