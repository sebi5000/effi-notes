'use client';

import { useCopyToClipboard } from '@/lib/notes/use-copy-to-clipboard.ts';

type Props = {
  /** In-app path to copy; the absolute URL is built from the origin on click. */
  path: string;
  /** Accessible label for the action. */
  label: string;
  /** Accessible label shown briefly after a successful copy. */
  copiedLabel: string;
  /** Row-specific styling so the button matches its neighbours. */
  className?: string;
};

/**
 * Hover-revealed action that copies a resource's absolute in-app URL to the
 * clipboard, with transient "copied" feedback. Shared by note rows and folder
 * rows. The absolute URL is composed from `window.location.origin` at click
 * time, so the component is safe to render server-side.
 */
export function CopyLinkButton({ path, label, copiedLabel, className }: Props) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : label}
      onClick={(e) => {
        e.stopPropagation();
        void copy(`${window.location.origin}${path}`);
      }}
      className={className}
    >
      <span aria-hidden="true">{copied ? '✓' : '🔗'}</span>
    </button>
  );
}
