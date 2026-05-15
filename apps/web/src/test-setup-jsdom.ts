/**
 * Vitest jsdom setup — fixes two incompatibilities between jsdom and Node.js
 * ≥ 22 when vitest's `globals` option is `false` (the project default).
 *
 * 1. localStorage / sessionStorage shadowing
 *    Node.js ≥ 22 ships built-in `localStorage` / `sessionStorage` stubs that
 *    lack `setItem`, `getItem`, `clear`, etc. vitest's `populateGlobal` skips
 *    keys already on `globalThis` unless they appear in its hard-coded
 *    allow-list (LIVING_KEYS + OTHER_KEYS). Because `localStorage` is not in
 *    that list, the Node.js stubs shadow jsdom's real Storage objects.
 *    Fix: replace the stubs with jsdom's implementations after environment
 *    setup.
 *
 * 2. @testing-library/react auto-cleanup
 *    RTL's index.js registers `cleanup()` via `afterEach` at module-load time
 *    with the check `typeof afterEach === 'function'`. With `globals: false`,
 *    `afterEach` is not on `globalThis`, so RTL skips auto-registration.
 *    Without cleanup, `renderHook` instances from previous tests are never
 *    unmounted, leaving stale `window.addEventListener` registrations that
 *    corrupt subsequent tests (e.g. stale keydown handlers fire alongside the
 *    new test's handler, toggling state an even number of times back to the
 *    original value).
 *    Fix: import `afterEach` from `vitest` here and register `cleanup()`
 *    ourselves — the same thing RTL would do if globals were enabled.
 */

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// `jsdom` is injected as a global by vitest's jsdom environment.
// It is not part of the standard TypeScript DOM lib, so we declare it locally.
declare const jsdom: { window: Window & typeof globalThis } | undefined;

// Only patch when we are actually inside the jsdom environment.
// `jsdom` global is injected by vitest's jsdom environment (global.jsdom = dom).
if (typeof jsdom !== 'undefined') {
  const win = jsdom.window;
  // Object.defineProperty is used instead of direct assignment to avoid
  // TypeScript's "localStorage is read-only" error on globalThis, and to
  // avoid the biome noExplicitAny rule on `as any` casts.
  Object.defineProperty(globalThis, 'localStorage', {
    value: win.localStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: win.sessionStorage,
    writable: true,
    configurable: true,
  });

  // Register RTL's cleanup so renderHook / render unmount after every test,
  // preventing stale event listeners from leaking across tests.
  afterEach(() => {
    cleanup();
  });
}
