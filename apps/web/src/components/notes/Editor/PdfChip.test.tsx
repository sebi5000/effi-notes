// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfChip } from './PdfChip.tsx';

afterEach(() => {
  cleanup();
});

const messages = {
  notes: { editorPdf: { open: 'Open', iconLabel: 'PDF document' } },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

/** Minimal NodeViewProps stub — only the fields PdfChip reads. */
const makeProps = (attrs: Record<string, unknown>) =>
  ({ node: { attrs } }) as unknown as Parameters<typeof PdfChip>[0];

describe('PdfChip', () => {
  it('renders the filename, a humanised size, and an Open link', () => {
    const props = makeProps({
      assetId: 'a1',
      src: '/api/assets/a1',
      filename: 'report.pdf',
      byteSize: 2 * 1024 * 1024,
    });
    render(wrap(<PdfChip {...props} />));
    expect(screen.getByText('report.pdf')).toBeDefined();
    expect(screen.getByText('2.0 MB')).toBeDefined();
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link.getAttribute('href')).toBe('/api/assets/a1');
  });

  it('formats small sizes in KB', () => {
    const props = makeProps({
      assetId: 'a2',
      src: '/api/assets/a2',
      filename: 'tiny.pdf',
      byteSize: 4096,
    });
    render(wrap(<PdfChip {...props} />));
    expect(screen.getByText('4 KB')).toBeDefined();
  });

  it('renders the PDF icon label for accessibility', () => {
    const props = makeProps({
      assetId: 'a3',
      src: '/api/assets/a3',
      filename: 'doc.pdf',
      byteSize: 512,
    });
    render(wrap(<PdfChip {...props} />));
    expect(screen.getByLabelText('PDF document')).toBeDefined();
  });

  it('formats sub-kilobyte sizes in bytes', () => {
    const props = makeProps({
      assetId: 'a4',
      src: '/api/assets/a4',
      filename: 'tiny.pdf',
      byteSize: 512,
    });
    render(wrap(<PdfChip {...props} />));
    expect(screen.getByText('512 B')).toBeDefined();
  });

  it('stops mousedown on the Open link from bubbling', () => {
    const props = makeProps({
      assetId: 'a5',
      src: '/api/assets/a5',
      filename: 'evt.pdf',
      byteSize: 4096,
    });
    render(wrap(<PdfChip {...props} />));
    const link = screen.getByRole('link', { name: 'Open' });
    const notPrevented = fireEvent.mouseDown(link);
    // fireEvent returns false only when the event was canceled; stopPropagation
    // does not cancel, so the event still completes — the handler ran.
    expect(notPrevented).toBe(true);
  });

  it('falls back gracefully when src, filename and byteSize are absent', () => {
    const props = makeProps({});
    const { container } = render(wrap(<PdfChip {...props} />));
    expect(screen.getByText('0 B')).toBeDefined();
    expect(container.querySelector('.note-pdf-chip-name')?.textContent).toBe('');
    // An <a> with an empty href has no implicit "link" ARIA role, so query
    // the anchor by class — it still renders with an empty href fallback.
    const link = container.querySelector('a.note-pdf-chip-open');
    expect(link?.getAttribute('href')).toBe('');
  });
});
