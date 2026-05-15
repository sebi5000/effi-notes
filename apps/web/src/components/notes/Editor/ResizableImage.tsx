'use client';

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { assetsApi } from '@/lib/notes/api-client.ts';
import { debounce } from '@/lib/notes/debounce.ts';
import { clampImageWidth } from '@/lib/notes/image-resize.ts';

/** Pulls the asset id out of a `/api/assets/<id>` src URL. */
const assetIdFromSrc = (src: string): string => src.split('/').filter(Boolean).pop() ?? '';

/**
 * NodeView for the editor image node. Renders the image, a corner resize
 * handle (aspect ratio kept — only the width changes; `max-width: 100%` in
 * CSS is the hard bound), and an editable caption. Caption edits update the
 * node attribute and are mirrored to `Asset.caption` (debounced) so search
 * stays current.
 */
export function ResizableImage({ node, updateAttributes, selected }: NodeViewProps) {
  const t = useTranslations('notes.editorImage');
  const src = String(node.attrs.src ?? '');
  const storedWidth = typeof node.attrs.width === 'number' ? node.attrs.width : null;
  const caption = String(node.attrs.caption ?? '');
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const patchCaption = useRef(
    debounce((id: string, value: string) => {
      void assetsApi.patchCaption(id, value).catch(() => undefined);
    }, 600),
  ).current;

  const onCaptionChange = (value: string) => {
    updateAttributes({ caption: value });
    const id = assetIdFromSrc(src);
    if (id) patchCaption(id, value);
  };

  const onHandlePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const img = frameRef.current?.querySelector('img');
    if (!img) return;
    const startX = e.clientX;
    const startWidth = img.clientWidth;
    const available = img.parentElement?.clientWidth ?? startWidth;
    const onMove = (ev: globalThis.PointerEvent) => {
      setDragWidth(clampImageWidth(startWidth + (ev.clientX - startX), available));
    };
    const onUp = (ev: globalThis.PointerEvent) => {
      updateAttributes({ width: clampImageWidth(startWidth + (ev.clientX - startX), available) });
      setDragWidth(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const renderWidth = dragWidth ?? storedWidth;

  return (
    <NodeViewWrapper
      as="figure"
      className="note-image"
      data-selected={selected ? 'true' : undefined}
    >
      <div ref={frameRef} className="note-image-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- Tiptap NodeView owns the DOM; next/image wrappers break the NodeView mount contract */}
        <img
          src={src}
          alt={caption}
          draggable={false}
          style={renderWidth !== null ? { width: `${renderWidth}px` } : undefined}
        />
        {selected ? (
          <span
            data-testid="image-resize-handle"
            className="note-image-handle"
            aria-hidden="true"
            onPointerDown={onHandlePointerDown}
          />
        ) : null}
      </div>
      <figcaption>
        <input
          type="text"
          contentEditable={false}
          className="note-image-caption"
          value={caption}
          placeholder={t('captionPlaceholder')}
          onChange={(e) => onCaptionChange(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </figcaption>
    </NodeViewWrapper>
  );
}
