'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { DocLink } from '@/lib/notes/doc-outline.ts';

type Props = {
  links: ReadonlyArray<DocLink>;
  /** App origin, used to resolve an internal link's in-app path. */
  origin: string;
};

/** The in-app pathname an internal note link points at (e.g. `/notes/abc`). */
const notePath = (href: string, origin: string): string => {
  try {
    return new URL(href, origin).pathname;
  } catch {
    return href;
  }
};

/**
 * The document panel's Links section: the note's links split into Internal
 * (note-to-note, client-side `next/link`) and External (opened in a new tab).
 */
export function LinksSection({ links, origin }: Props) {
  const t = useTranslations('notes.docPanel');
  const internal = links.filter((l) => l.internal);
  const external = links.filter((l) => !l.internal);

  return (
    <section className="doc-panel-section">
      <h3 className="doc-panel-heading">{t('links')}</h3>
      {links.length === 0 ? (
        <p className="doc-panel-empty">{t('empty.links')}</p>
      ) : (
        <>
          {internal.length > 0 ? (
            <>
              <h4 className="doc-panel-subheading">{t('internal')}</h4>
              <ul className="doc-panel-list">
                {internal.map((l) => (
                  <li key={`${l.pos}-${l.href}`}>
                    <Link className="doc-panel-link-row" href={notePath(l.href, origin) as Route}>
                      {l.text || l.href}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {external.length > 0 ? (
            <>
              <h4 className="doc-panel-subheading">{t('external')}</h4>
              <ul className="doc-panel-list">
                {external.map((l) => (
                  <li key={`${l.pos}-${l.href}`}>
                    <a
                      className="doc-panel-link-row"
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {l.text || l.href}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
