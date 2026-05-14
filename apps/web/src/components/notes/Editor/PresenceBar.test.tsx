// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { initialsFromName, PresenceBar } from './PresenceBar.tsx';

afterEach(cleanup);

describe('initialsFromName', () => {
  it('returns "?" for empty/nullish input', () => {
    expect(initialsFromName(null)).toBe('?');
    expect(initialsFromName(undefined)).toBe('?');
    expect(initialsFromName('')).toBe('?');
    expect(initialsFromName('   ')).toBe('?');
  });

  it('takes first two letters for a single-word name', () => {
    expect(initialsFromName('Mara')).toBe('MA');
  });

  it('combines first letter of first and last word for multi-word names', () => {
    expect(initialsFromName('Mara Kessler')).toBe('MK');
    expect(initialsFromName('  Jonas  Albrecht  ')).toBe('JA');
    expect(initialsFromName('Anne Marie van Buren')).toBe('AB');
  });
});

describe('PresenceBar', () => {
  it('renders nothing when there are no users', () => {
    const { container } = render(<PresenceBar users={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders up to 6 avatars with a +N overflow marker', () => {
    const users = Array.from({ length: 8 }, (_, i) => ({
      clientId: i,
      initials: `U${i}`,
      colorHex: '#C26A20',
    }));
    const { container } = render(<PresenceBar users={users} />);
    const list = within(container).getByLabelText('presence');
    expect(list.querySelectorAll('li').length).toBe(7); // 6 avatars + 1 overflow
    expect(list.textContent).toContain('+2');
  });

  it('renders exactly N avatars when N ≤ 6', () => {
    const users = Array.from({ length: 3 }, (_, i) => ({
      clientId: i,
      initials: `U${i}`,
      colorHex: '#C26A20',
    }));
    const { container } = render(<PresenceBar users={users} />);
    expect(within(container).getByLabelText('presence').querySelectorAll('li').length).toBe(3);
  });
});
