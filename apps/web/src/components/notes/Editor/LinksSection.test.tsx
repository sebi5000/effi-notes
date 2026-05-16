// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocLink } from '@/lib/notes/doc-outline.ts';
import { LinksSection } from './LinksSection.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    docPanel: {
      links: 'Links',
      internal: 'Internal',
      external: 'External',
      empty: { links: 'No links' },
    },
  },
};
const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const links: DocLink[] = [
  { href: '/notes/abc', text: 'see note', pos: 2, internal: true },
  { href: 'https://example.com/p', text: 'the web', pos: 8, internal: false },
];

describe('LinksSection', () => {
  it('shows the empty state when there are no links', () => {
    render(wrap(<LinksSection links={[]} origin="http://localhost:3000" />));
    expect(screen.getByText('No links')).toBeTruthy();
  });

  it('puts an internal note link under Internal as an in-app link', () => {
    render(wrap(<LinksSection links={links} origin="http://localhost:3000" />));
    const internal = screen.getByText('see note').closest('a');
    expect(internal?.getAttribute('href')).toBe('/notes/abc');
    expect(internal?.getAttribute('target')).toBeNull();
  });

  it('puts an external link under External, opening in a new tab', () => {
    render(wrap(<LinksSection links={links} origin="http://localhost:3000" />));
    const external = screen.getByText('the web').closest('a');
    expect(external?.getAttribute('href')).toBe('https://example.com/p');
    expect(external?.getAttribute('target')).toBe('_blank');
  });

  it('renders only the External group when all links are external, falling back to the href', () => {
    const externalOnly: DocLink[] = [
      { href: 'https://only-ext.com/p', text: '', pos: 1, internal: false },
    ];
    render(wrap(<LinksSection links={externalOnly} origin="http://localhost:3000" />));
    expect(screen.getByText('External')).toBeTruthy();
    expect(screen.queryByText('Internal')).toBeNull();
    expect(screen.getByText('https://only-ext.com/p')).toBeTruthy();
  });

  it('renders only the Internal group, keeping the href when notePath cannot resolve it', () => {
    const internalOnly: DocLink[] = [{ href: '/notes/only-int', text: '', pos: 1, internal: true }];
    render(wrap(<LinksSection links={internalOnly} origin="" />));
    expect(screen.getByText('Internal')).toBeTruthy();
    expect(screen.queryByText('External')).toBeNull();
    expect(screen.getByText('/notes/only-int').closest('a')?.getAttribute('href')).toBe(
      '/notes/only-int',
    );
  });
});
