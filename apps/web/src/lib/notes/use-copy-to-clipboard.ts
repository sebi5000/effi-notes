'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Clipboard helper with transient "copied" feedback.
 *
 * `copy(text)` writes to the clipboard and flips `copied` true for `resetMs`.
 * A failed write (no permission, insecure context) leaves `copied` false —
 * the caller stays usable. The reset timer is cleared on unmount.
 */
export const useCopyToClipboard = (
  resetMs = 2000,
): { copied: boolean; copy: (text: string) => Promise<void> } => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
      } catch {
        // clipboard unavailable or denied — leave state unchanged
      }
    },
    [resetMs],
  );

  return { copied, copy };
};
