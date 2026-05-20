/**
 * State machine for the SaveIndicator. The editor reduces a stream of events
 * into one of these states; the indicator picks an icon + label per state.
 *
 *   idle       → no edits since last save
 *   dirty      → at least one local edit since last save
 *   saving     → a save request is in flight
 *   saved      → success terminal — UI flashes briefly then collapses to idle
 *   conflict   → server replied 409 (PUT body) — needs user attention
 *   offline    → fetch/network error during save — will retry
 *
 * Transitions are total — any event in any state has a defined result.
 */

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'offline';

export type SaveEvent =
  | { kind: 'edit' }
  | { kind: 'save-start' }
  | { kind: 'save-ok' }
  | { kind: 'save-conflict' }
  | { kind: 'save-network-error' }
  | { kind: 'recovered' }
  | { kind: 'reset' };

export const initialSaveState: SaveState = 'idle';

export const reduceSaveState = (current: SaveState, event: SaveEvent): SaveState => {
  switch (event.kind) {
    case 'edit':
      // Once a conflict has been surfaced, additional local edits keep us
      // in conflict — the user must resolve before further saves run.
      if (current === 'conflict') return 'conflict';
      return 'dirty';
    case 'save-start':
      // Allowed from dirty or offline (retry). From idle/saved it's a noop.
      if (current === 'idle' || current === 'saved') return current;
      return 'saving';
    case 'save-ok':
      // Only acknowledge a save when we're still in `saving`. If an edit
      // arrived during the in-flight request the reducer already moved us
      // back to `dirty`, and the older response must not overwrite that.
      // (See QA review 2026-05-20, P1 finding.)
      return current === 'saving' ? 'saved' : current;
    case 'save-conflict':
      return 'conflict';
    case 'save-network-error':
      return 'offline';
    case 'recovered':
      // From offline back to dirty so the next save-start fires again.
      return current === 'offline' ? 'dirty' : current;
    case 'reset':
      return 'idle';
    default: {
      const _exhaustive: never = event;
      return current;
    }
  }
};
