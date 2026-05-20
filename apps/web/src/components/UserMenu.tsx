'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { signOutAction } from './user-menu-actions.ts';

type Props = {
  /** The current user — passed in by a server component that called auth(). */
  user: { displayName: string | null; email: string };
};

/** 2-character avatar initials from the displayName, falling back to the email local-part. */
const initialsOf = (displayName: string | null, email: string): string => {
  const trimmedName = displayName?.trim() ?? '';
  const source = trimmedName.length > 0 ? trimmedName : (email.split('@')[0] ?? '?');
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};

/**
 * Top-right user-profile dropdown — accessible (role=menu, Escape,
 * outside-click) and modeled on the editor's CalloutMenu. Shows the user,
 * links to /settings, and signs out via a server action.
 */
export function UserMenu({ user }: Props) {
  const t = useTranslations('userMenu');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const displayName = user.displayName ?? user.email;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('menuLabel')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="bg-muted hover:bg-paper-line/60 text-foreground inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold transition-colors"
      >
        {initialsOf(user.displayName, user.email)}
      </button>
      {open ? (
        <div
          role="menu"
          className="border-paper-line/80 bg-background absolute right-0 top-full z-50 mt-1 w-56 rounded-md border shadow-md"
        >
          <div className="border-paper-line/60 border-b px-3 py-2 text-xs">
            <div className="text-foreground font-medium">{displayName}</div>
            <div className="text-muted-foreground truncate">{user.email}</div>
          </div>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="hover:bg-muted text-foreground block px-3 py-2 text-sm"
          >
            {t('settings')}
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="hover:bg-muted text-foreground block w-full px-3 py-2 text-left text-sm"
            >
              {t('signOut')}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
