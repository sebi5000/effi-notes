// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { SaveIndicator } from './SaveIndicator.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    saveIndicator: {
      idle: 'Saved',
      dirty: 'Unsaved changes',
      saving: 'Saving…',
      saved: 'Saved',
      conflict: 'Conflict — needs review',
      offline: 'Offline · will retry',
      viewing: '{count} viewing',
    },
  },
} as const;

const renderIndicator = (state: Parameters<typeof SaveIndicator>[0]['state'], viewerCount = 1) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SaveIndicator state={state} viewerCount={viewerCount} />
    </NextIntlClientProvider>,
  );

describe('SaveIndicator', () => {
  it('renders the dirty state label', () => {
    const { container } = renderIndicator('dirty');
    expect(within(container).getByRole('status').textContent).toContain('Unsaved changes');
  });

  it('shows the viewer count when more than one viewer', () => {
    const { container } = renderIndicator('saved', 3);
    expect(within(container).getByRole('status').textContent).toContain('3 viewing');
  });

  it('hides the viewer count when alone', () => {
    const { container } = renderIndicator('saved', 1);
    expect(within(container).getByRole('status').textContent).not.toContain('viewing');
  });

  it('reflects the conflict state in the data-state attribute', () => {
    const { container } = renderIndicator('conflict');
    expect(within(container).getByRole('status').getAttribute('data-state')).toBe('conflict');
  });

  it('reflects the offline state in the data-state attribute', () => {
    const { container } = renderIndicator('offline');
    expect(within(container).getByRole('status').getAttribute('data-state')).toBe('offline');
  });

  it('renders saving state', () => {
    const { container } = renderIndicator('saving');
    expect(within(container).getByRole('status').textContent).toContain('Saving');
  });
});
