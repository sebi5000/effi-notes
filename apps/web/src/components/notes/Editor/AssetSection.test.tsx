// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetItem } from '@/lib/notes/doc-outline.ts';
import { AssetSection } from './AssetSection.tsx';

afterEach(cleanup);

const messages = {
  notes: { docPanel: { images: 'Images', pdfs: 'PDFs', empty: { images: 'No images' } } },
};
const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const items: AssetItem[] = [
  { kind: 'image', src: '/api/assets/i1', previewSrc: '/api/assets/i1', label: 'Diagram', pos: 4 },
];

describe('AssetSection', () => {
  it('renders the title and each item', () => {
    render(
      wrap(<AssetSection title="Images" emptyText="No images" items={items} onSelect={() => {}} />),
    );
    expect(screen.getByText('Images')).toBeTruthy();
    expect(screen.getByText('Diagram')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/assets/i1');
  });

  it('shows the empty state', () => {
    render(
      wrap(<AssetSection title="Images" emptyText="No images" items={[]} onSelect={() => {}} />),
    );
    expect(screen.getByText('No images')).toBeTruthy();
  });

  it('calls onSelect with the node position when an item is clicked', () => {
    const onSelect = vi.fn();
    render(
      wrap(<AssetSection title="Images" emptyText="No images" items={items} onSelect={onSelect} />),
    );
    fireEvent.click(screen.getByText('Diagram'));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it('falls back to a placeholder when the thumbnail fails to load', () => {
    const pdfItem: AssetItem[] = [
      {
        kind: 'pdf',
        src: '/api/assets/p1',
        previewSrc: '/api/assets/p1/preview',
        label: 'r.pdf',
        pos: 9,
      },
    ];
    render(
      wrap(<AssetSection title="PDFs" emptyText="No PDFs" items={pdfItem} onSelect={() => {}} />),
    );
    const img = screen.getByRole('img');
    fireEvent.error(img);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('asset-thumb-placeholder')).toBeTruthy();
  });

  it('renders the placeholder immediately and falls back to src when previewSrc and label are empty', () => {
    const noPreview: AssetItem[] = [
      { kind: 'pdf', src: '/api/assets/x', previewSrc: '', label: '', pos: 3 },
    ];
    render(
      wrap(<AssetSection title="PDFs" emptyText="No PDFs" items={noPreview} onSelect={() => {}} />),
    );
    expect(screen.getByTestId('asset-thumb-placeholder')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('/api/assets/x')).toBeTruthy();
  });
});
