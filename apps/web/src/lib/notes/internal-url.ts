import type { FolderNode } from '@/lib/api/schemas.ts';
import { folderPath } from './folder-tree.ts';

/**
 * In-app links for the "Copy link" action. These are normal authenticated
 * URLs — opening one still requires a session and an access grant. (The
 * account-less public link is a separate feature; see ADR 0028.)
 *
 * Callers compose the absolute URL with `window.location.origin` at copy time.
 */

/** Path to open a note. */
export const noteInternalUrl = (noteId: string): string => `/notes/${noteId}`;

/**
 * Path to open a folder. Folders have no dedicated route — the app navigates
 * to them through the `?q=/<path>` command filter, so the link mirrors that.
 * Returns `/notes` when the folder id cannot be resolved to a path.
 */
export const folderInternalUrl = (folders: ReadonlyArray<FolderNode>, folderId: string): string => {
  const path = folderPath(folders, folderId);
  return path.length > 0 ? `/notes?q=${encodeURIComponent(`/${path}`)}` : '/notes';
};
