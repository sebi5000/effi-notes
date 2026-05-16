// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutlineHeading } from '@/lib/notes/doc-outline.ts';
import { OutlineSection } from './OutlineSection.tsx';

afterEach(cleanup);

const messages = {
  notes: { docPanel: { outline: 'Outline', empty: { outline: 'No headings yet' } } },
};
const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const headings: OutlineHeading[] = [
  { level: 1, text: 'Intro', pos: 0 },
  { level: 2, text: 'Details', pos: 10 },
];

describe('OutlineSection', () => {
  it('renders each heading', () => {
    render(wrap(<OutlineSection headings={headings} activeIndex={0} onSelect={() => {}} />));
    expect(screen.getByText('Intro')).toBeTruthy();
    expect(screen.getByText('Details')).toBeTruthy();
  });

  it('shows the empty state when there are no headings', () => {
    render(wrap(<OutlineSection headings={[]} activeIndex={-1} onSelect={() => {}} />));
    expect(screen.getByText('No headings yet')).toBeTruthy();
  });

  it('calls onSelect with the heading position when clicked', () => {
    const onSelect = vi.fn();
    render(wrap(<OutlineSection headings={headings} activeIndex={0} onSelect={onSelect} />));
    fireEvent.click(screen.getByText('Details'));
    expect(onSelect).toHaveBeenCalledWith(10);
  });

  it('marks the active heading with aria-current', () => {
    render(wrap(<OutlineSection headings={headings} activeIndex={1} onSelect={() => {}} />));
    expect(screen.getByText('Details').getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Intro').getAttribute('aria-current')).toBeNull();
  });

  it('falls back to the empty label for a heading with no text', () => {
    const blank: OutlineHeading[] = [{ level: 1, text: '', pos: 5 }];
    render(wrap(<OutlineSection headings={blank} activeIndex={-1} onSelect={() => {}} />));
    // With one (non-empty) heading there is no empty-state <p>, so this
    // resolves to the row <button> using its fallback label.
    expect(screen.getByText('No headings yet').tagName).toBe('BUTTON');
  });
});
