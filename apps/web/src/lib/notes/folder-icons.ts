import { z } from 'zod';

/**
 * The curated set of folder icons, by Lucide icon name. The array order is the
 * order the picker grid renders. To add an icon: add its Lucide key here, add
 * its component to the map in `FolderIcon.tsx`, and add a `names.<key>` entry
 * to both message catalogues. This module is pure (no React, no lucide-react)
 * so it is safe to import from server code such as the API schemas.
 */
export const FOLDER_ICONS = [
  'folder',
  'folder-open',
  'briefcase',
  'house',
  'user',
  'users',
  'star',
  'archive',
  'inbox',
  'file-text',
  'book-open',
  'graduation-cap',
  'code',
  'rocket',
  'lightbulb',
  'calendar',
  'list-checks',
  'heart',
  'flag',
  'image',
  'music',
  'wallet',
  'globe',
  'mail',
] as const;

/** A folder-icon key — one of the curated set. */
export type FolderIcon = (typeof FOLDER_ICONS)[number];

/** The icon every folder starts with, and the render-time fallback. */
export const DEFAULT_FOLDER_ICON: FolderIcon = 'folder';

/** Zod enum over the curated set — validates the write path (the PATCH body). */
export const folderIconSchema = z.enum(FOLDER_ICONS);

/** Narrowing guard — true when `value` is a known folder-icon key. */
export const isFolderIcon = (value: string): value is FolderIcon =>
  (FOLDER_ICONS as readonly string[]).includes(value);
