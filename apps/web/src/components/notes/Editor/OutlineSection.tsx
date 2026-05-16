'use client';

import { useTranslations } from 'next-intl';
import type { OutlineHeading } from '@/lib/notes/doc-outline.ts';

type Props = {
  headings: ReadonlyArray<OutlineHeading>;
  /** Index of the heading currently scrolled into view, or -1. */
  activeIndex: number;
  /** Called with the heading's ProseMirror position when a row is clicked. */
  onSelect: (pos: number) => void;
};

/**
 * The document panel's heading outline. Rows are indented by heading level;
 * the active heading (computed by the container's scroll-spy) is marked with
 * `aria-current`. Presentational only.
 */
export function OutlineSection({ headings, activeIndex, onSelect }: Props) {
  const t = useTranslations('notes.docPanel');

  return (
    <section className="doc-panel-section">
      <h3 className="doc-panel-heading">{t('outline')}</h3>
      {headings.length === 0 ? (
        <p className="doc-panel-empty">{t('empty.outline')}</p>
      ) : (
        <ul className="doc-panel-list">
          {headings.map((h, i) => (
            <li key={`${h.pos}-${h.text}`}>
              <button
                type="button"
                className="doc-panel-outline-row"
                style={{ paddingLeft: `${(h.level - 1) * 0.75 + 0.25}rem` }}
                aria-current={i === activeIndex ? 'true' : undefined}
                onClick={() => onSelect(h.pos)}
              >
                {h.text || t('empty.outline')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
