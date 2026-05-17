// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderIconPicker } from './FolderIconPicker.tsx';

afterEach(cleanup);

const messages = {
  notes: {
    folderIcons: {
      pickerLabel: 'Change folder icon',
      names: {
        folder: 'Folder',
        'folder-open': 'Open folder',
        briefcase: 'Briefcase',
        house: 'House',
        user: 'Person',
        users: 'People',
        star: 'Star',
        archive: 'Archive',
        inbox: 'Inbox',
        'file-text': 'Document',
        'book-open': 'Book',
        'graduation-cap': 'Education',
        code: 'Code',
        rocket: 'Rocket',
        lightbulb: 'Idea',
        calendar: 'Calendar',
        'list-checks': 'Checklist',
        heart: 'Heart',
        flag: 'Flag',
        image: 'Image',
        music: 'Music',
        wallet: 'Wallet',
        globe: 'Globe',
        mail: 'Mail',
      },
    },
  },
};

const RECT = { bottom: 120, left: 40, top: 100, right: 56 } as DOMRect;

const renderPicker = (current = 'briefcase') => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FolderIconPicker anchorRect={RECT} current={current} onPick={onPick} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
  return { onPick, onClose, dialog };
};

describe('FolderIconPicker', () => {
  it('renders a button for each of the 24 curated icons', () => {
    const { dialog } = renderPicker();
    expect(dialog.querySelectorAll('button[data-icon]')).toHaveLength(24);
  });

  it('marks the current icon active', () => {
    const { dialog } = renderPicker('rocket');
    const active = dialog.querySelector('button[data-active="true"]');
    expect(active?.getAttribute('data-icon')).toBe('rocket');
  });

  it('calls onPick with the chosen icon key', () => {
    const { dialog, onPick } = renderPicker();
    const star = dialog.querySelector('button[data-icon="star"]') as HTMLButtonElement;
    fireEvent.click(star);
    expect(onPick).toHaveBeenCalledWith('star');
  });

  it('closes on Escape', () => {
    const { dialog, onClose } = renderPicker();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on an outside pointerdown', async () => {
    const { onClose } = renderPicker();
    await new Promise((r) => setTimeout(r, 0)); // let the deferred listener attach
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus with ArrowRight', () => {
    const { dialog } = renderPicker('folder');
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button[data-icon]')];
    buttons[0]?.focus();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('moves focus with ArrowDown by one grid row', () => {
    const { dialog } = renderPicker('folder');
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button[data-icon]')];
    buttons[0]?.focus();
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[6]);
  });

  it('moves focus with ArrowUp by one grid row', () => {
    const { dialog } = renderPicker('folder');
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button[data-icon]')];
    buttons[6]?.focus();
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('focuses the current icon button when it opens', () => {
    renderPicker('rocket');
    expect((document.activeElement as HTMLElement)?.getAttribute('data-icon')).toBe('rocket');
  });

  it('closes when the window scrolls', () => {
    const { onClose } = renderPicker();
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalled();
  });
});
