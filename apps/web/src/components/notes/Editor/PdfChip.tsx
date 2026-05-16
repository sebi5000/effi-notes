'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useTranslations } from 'next-intl';

/** Humanises a byte count for display in the chip. */
const humanSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * NodeView for the editor's `pdfChip` node — a compact, non-editable card:
 * a PDF badge, the filename, the humanised file size, and an "Open" link to
 * the asset download. The first-page preview is rendered server-side (for
 * sub-project C) and is intentionally not shown here.
 */
export function PdfChip({ node }: NodeViewProps) {
  const t = useTranslations('notes.editorPdf');
  const src = String(node.attrs.src ?? '');
  const filename = String(node.attrs.filename ?? '');
  const byteSize = typeof node.attrs.byteSize === 'number' ? node.attrs.byteSize : 0;

  return (
    <NodeViewWrapper as="div" className="note-pdf-chip" data-testid="pdf-chip">
      <span className="note-pdf-chip-icon" role="img" aria-label={t('iconLabel')}>
        PDF
      </span>
      <span className="note-pdf-chip-name">{filename}</span>
      <span className="note-pdf-chip-size">{humanSize(byteSize)}</span>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="note-pdf-chip-open"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {t('open')}
      </a>
    </NodeViewWrapper>
  );
}
