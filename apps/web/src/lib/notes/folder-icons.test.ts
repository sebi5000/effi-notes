import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOLDER_ICON,
  FOLDER_ICONS,
  folderIconSchema,
  isFolderIcon,
} from './folder-icons.ts';

describe('FOLDER_ICONS', () => {
  it('has 24 entries', () => {
    expect(FOLDER_ICONS).toHaveLength(24);
  });

  it('has no duplicates', () => {
    expect(new Set(FOLDER_ICONS).size).toBe(FOLDER_ICONS.length);
  });

  it('includes the default icon', () => {
    expect(FOLDER_ICONS).toContain(DEFAULT_FOLDER_ICON);
  });
});

describe('folderIconSchema', () => {
  it('accepts a known icon key', () => {
    expect(folderIconSchema.safeParse('briefcase').success).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(folderIconSchema.safeParse('not-an-icon').success).toBe(false);
  });
});

describe('isFolderIcon', () => {
  it('is true for a known key', () => {
    expect(isFolderIcon('rocket')).toBe(true);
  });

  it('is false for an unknown key', () => {
    expect(isFolderIcon('rocket-ship')).toBe(false);
  });
});
