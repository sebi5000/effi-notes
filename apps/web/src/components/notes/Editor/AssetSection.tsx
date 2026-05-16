'use client';

import { useState } from 'react';
import type { AssetItem } from '@/lib/notes/doc-outline.ts';

type Props = {
  title: string;
  emptyText: string;
  items: ReadonlyArray<AssetItem>;
  onSelect: (pos: number) => void;
};

/** A single thumbnail row — its own component so each tracks its load error. */
function AssetRow({ item, onSelect }: { item: AssetItem; onSelect: (pos: number) => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <li>
      <button type="button" className="doc-panel-asset-row" onClick={() => onSelect(item.pos)}>
        {failed || item.previewSrc === '' ? (
          <span
            className="doc-panel-asset-thumb-fallback"
            data-testid="asset-thumb-placeholder"
            aria-hidden="true"
          >
            {item.kind === 'pdf' ? 'PDF' : 'IMG'}
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- panel thumbnail — next/image cannot size an arbitrary asset
          <img
            src={item.previewSrc}
            alt={item.label || item.src}
            className="doc-panel-asset-thumb"
            onError={() => setFailed(true)}
          />
        )}
        <span className="doc-panel-asset-label">{item.label || item.src}</span>
      </button>
    </li>
  );
}

/**
 * A document-panel section listing image or PDF assets as thumbnail rows.
 * Shared by the Images and PDFs sections. Presentational only.
 */
export function AssetSection({ title, emptyText, items, onSelect }: Props) {
  return (
    <section className="doc-panel-section">
      <h3 className="doc-panel-heading">{title}</h3>
      {items.length === 0 ? (
        <p className="doc-panel-empty">{emptyText}</p>
      ) : (
        <ul className="doc-panel-list">
          {items.map((item) => (
            <AssetRow key={`${item.pos}-${item.src}`} item={item} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  );
}
