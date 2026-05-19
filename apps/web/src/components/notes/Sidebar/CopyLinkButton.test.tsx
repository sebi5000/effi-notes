// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyLinkButton } from './CopyLinkButton.tsx';

describe('CopyLinkButton', () => {
  it('copies the absolute URL for the given path on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { getByLabelText } = render(
      <CopyLinkButton path="/notes/n1" label="Copy link" copiedLabel="Link copied" />,
    );
    fireEvent.click(getByLabelText('Copy link'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toBe(`${window.location.origin}/notes/n1`);
  });

  it('swaps to the copied label after a successful copy', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    const { getByLabelText } = render(
      <CopyLinkButton path="/notes/n1" label="Copy link" copiedLabel="Link copied" />,
    );
    fireEvent.click(getByLabelText('Copy link'));

    await waitFor(() => expect(getByLabelText('Link copied')).toBeTruthy());
  });
});
