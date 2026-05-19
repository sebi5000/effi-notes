/**
 * Controllable `window.matchMedia` stub for jsdom tests.
 *
 * jsdom does not implement `matchMedia`; any component or hook that calls it
 * throws `matchMedia is not a function`. `installMatchMedia` installs a stub
 * where every query starts non-matching (a wide viewport); tests flip a
 * query's match state — emitting a `change` event — via the returned
 * controller.
 *
 * Call it in `beforeEach`. vitest rebuilds the jsdom environment per test
 * file, so no explicit uninstall is needed.
 */

type ChangeListener = () => void;

type QueryState = {
  matches: boolean;
  listeners: Set<ChangeListener>;
};

export type MatchMediaController = {
  /** Set whether `query` matches now; notifies subscribed listeners. */
  set: (query: string, matches: boolean) => void;
};

export const installMatchMedia = (): MatchMediaController => {
  const states = new Map<string, QueryState>();

  const stateFor = (query: string): QueryState => {
    const existing = states.get(query);
    if (existing !== undefined) return existing;
    const created: QueryState = { matches: false, listeners: new Set() };
    states.set(query, created);
    return created;
  };

  const matchMedia = (query: string): MediaQueryList => {
    const state = stateFor(query);
    return {
      media: query,
      get matches() {
        return state.matches;
      },
      addEventListener: (_type: string, cb: ChangeListener) => {
        state.listeners.add(cb);
      },
      removeEventListener: (_type: string, cb: ChangeListener) => {
        state.listeners.delete(cb);
      },
    } as unknown as MediaQueryList;
  };

  Object.defineProperty(window, 'matchMedia', {
    value: matchMedia,
    writable: true,
    configurable: true,
  });

  return {
    set: (query: string, matches: boolean) => {
      const state = stateFor(query);
      state.matches = matches;
      for (const cb of state.listeners) cb();
    },
  };
};
