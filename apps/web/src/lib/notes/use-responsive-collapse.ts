import { useCallback, useState } from 'react';
import { useMediaQuery } from './use-media-query.ts';

type Args = {
  /** Match means "narrow viewport" — e.g. '(max-width: 1279px)'. */
  query: string;
  /** The persisted collapsed state — meaningful at wide widths. */
  collapsed: boolean;
  /** Toggles the persisted collapsed state. */
  toggle: () => void;
};

type Result = {
  /** Effective collapsed state — auto-collapsed while narrow. */
  collapsed: boolean;
  /** Toggle: the transient narrow state when narrow, the persisted store when wide. */
  toggle: () => void;
  /** Forces collapsed while narrow; a no-op (harmless) when wide. */
  collapse: () => void;
  /** Whether the viewport currently matches the narrow query. */
  isNarrow: boolean;
};

/**
 * Layers a viewport-driven auto-collapse over a persisted collapse preference.
 *
 * At wide widths the persisted `collapsed` / `toggle` pass straight through.
 * At narrow widths a transient state takes over: it defaults to collapsed and
 * resets to collapsed every time the viewport re-enters narrow mode, so the
 * persisted preference is never written by a viewport change.
 */
export const useResponsiveCollapse = ({ query, collapsed, toggle }: Args): Result => {
  const isNarrow = useMediaQuery(query);
  const [narrowCollapsed, setNarrowCollapsed] = useState(true);

  // Reset the transient state to "collapsed" whenever the viewport re-enters
  // narrow mode — React's documented "adjust state when a prop changes"
  // pattern, the same one NotesShell uses for dragWidth. Guarded so it
  // converges.
  const [wasNarrow, setWasNarrow] = useState(isNarrow);
  if (isNarrow !== wasNarrow) {
    setWasNarrow(isNarrow);
    if (isNarrow) setNarrowCollapsed(true);
  }

  const narrowToggle = useCallback(() => {
    setNarrowCollapsed((c) => !c);
  }, []);

  const collapse = useCallback(() => {
    setNarrowCollapsed(true);
  }, []);

  return {
    collapsed: isNarrow ? narrowCollapsed : collapsed,
    toggle: isNarrow ? narrowToggle : toggle,
    collapse,
    isNarrow,
  };
};
