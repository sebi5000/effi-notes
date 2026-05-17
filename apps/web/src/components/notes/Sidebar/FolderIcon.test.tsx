// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FolderIcon } from './FolderIcon.tsx';

afterEach(cleanup);

describe('FolderIcon', () => {
  it('renders the svg for a known icon key', () => {
    const { container } = render(<FolderIcon icon="rocket" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('lucide-rocket')).toBe(true);
  });

  it('falls back to the folder icon for an unknown key', () => {
    const { container } = render(<FolderIcon icon="bogus-key" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('lucide-folder')).toBe(true);
  });

  it('passes className through to the svg', () => {
    const { container } = render(<FolderIcon icon="folder" className="size-4 text-accent" />);
    expect(container.querySelector('svg')?.classList.contains('size-4')).toBe(true);
  });
});
