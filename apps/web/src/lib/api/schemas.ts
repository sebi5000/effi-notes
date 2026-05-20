import { z } from 'zod';
import { folderIconSchema } from '@/lib/notes/folder-icons.ts';
import { THEME_IDS } from '@/lib/theme/themes.ts';

/**
 * Shared Zod schemas + types for the notes REST API.
 *
 * API-first contract: route handlers parse request bodies/params with these
 * schemas and the same types are re-exported to the frontend so the
 * fetch-layer is end-to-end typed. Never accept un-parsed external input.
 */

const TITLE_MAX = 200;
const TAG_NAME_MAX = 64;
const FOLDER_NAME_MAX = 120;
const BODY_MAX = 1_000_000; // 1 MB markdown ceiling — well above any realistic note
const SEARCH_QUERY_MAX = 200;
const FILENAME_MAX = 255;
const CAPTION_MAX = 1000;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export const cuidSchema = z.string().min(1).max(40);

export const createNoteSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  folderId: cuidSchema.nullable().optional(),
  tagIds: z.array(cuidSchema).max(50).optional(),
  body: z.string().max(BODY_MAX).optional(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const patchNoteSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX).optional(),
    folderId: cuidSchema.nullable().optional(),
    tagIds: z.array(cuidSchema).max(50).optional(),
    archivedAt: z.iso.datetime().nullable().optional(),
    titleManuallySet: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type PatchNoteInput = z.infer<typeof patchNoteSchema>;

export const putNoteBodySchema = z.object({
  body: z.string().max(BODY_MAX),
  // Optimistic-concurrency token from the last GET. Server rejects with 409
  // if the note has changed since.
  baseUpdatedAt: z.iso.datetime(),
  // The asset ids the editor's current document references. Optional — when
  // omitted (e.g. import/automation callers), the body route skips the
  // asset-cleanup reconcile entirely rather than treating the note as
  // asset-less.
  assetIds: z.array(cuidSchema).max(500).optional(),
});
export type PutNoteBodyInput = z.infer<typeof putNoteBodySchema>;

export const listNotesQuerySchema = z.object({
  folderId: cuidSchema.optional(),
  tagId: cuidSchema.optional(),
  q: z.string().max(SEARCH_QUERY_MAX).optional(),
  includeArchived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;

export const createFolderSchema = z.object({
  name: z.string().min(1).max(FOLDER_NAME_MAX),
  parentId: cuidSchema.nullable().optional(),
  position: z.number().int().min(0).optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const patchFolderSchema = z
  .object({
    name: z.string().min(1).max(FOLDER_NAME_MAX).optional(),
    parentId: cuidSchema.nullable().optional(),
    position: z.number().int().min(0).optional(),
    icon: folderIconSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type PatchFolderInput = z.infer<typeof patchFolderSchema>;

/**
 * Bulk reorder: assign every id in `orderedIds` the parent `parentId` and a
 * contiguous `position` (0..n) in array order. Powers drag-and-drop —
 * handles both same-level reordering and cross-hierarchy moves in one
 * transaction.
 */
export const reorderFoldersSchema = z.object({
  parentId: cuidSchema.nullable(),
  orderedIds: z.array(cuidSchema).min(1).max(500),
});
export type ReorderFoldersInput = z.infer<typeof reorderFoldersSchema>;

export const createTagSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(TAG_NAME_MAX)
    .regex(
      /^[\p{L}\p{N}_-]+(?:#[\p{L}\p{N}_-]+)*$/u,
      'letters, numbers, _ and -, with # as an interior level separator',
    ),
  color: z.string().regex(HEX_COLOR, 'expect #RRGGBB').nullable().optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(SEARCH_QUERY_MAX),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export type NoteListItem = {
  id: string;
  title: string;
  snippet: string;
  folderId: string | null;
  authorId: string;
  archivedAt: string | null;
  updatedAt: string;
  tags: Array<{ id: string; name: string; color: string | null }>;
  shareCount: number;
  sharedWithMe?: SharedWithMe;
};

export type NoteDetail = NoteListItem & {
  body: string;
  createdAt: string;
  lastEditorId: string | null;
  titleManuallySet: boolean;
};

export type FolderNode = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  icon: string;
  createdAt: string;
  updatedAt: string;
  shareCount: number;
  sharedWithMe?: SharedWithMe;
};

export type TagItem = {
  id: string;
  name: string;
  color: string | null;
};

export type SearchHit = {
  id: string;
  title: string;
  snippet: string;
  folderId: string | null;
  updatedAt: string;
};

export type ApiError = { error: string; details?: unknown };

export const SHARE_ACCESS = ['VIEW', 'EDIT'] as const;
export const SHARE_TTL_UNITS = ['minutes', 'hours', 'days'] as const;

export const shareTtlSchema = z.object({
  value: z.number().int().min(1).max(1000),
  unit: z.enum(SHARE_TTL_UNITS),
});
export type ShareTtl = z.infer<typeof shareTtlSchema>;

export const shareCreateSchema = z.object({
  granteeId: cuidSchema,
  access: z.enum(SHARE_ACCESS),
  ttl: shareTtlSchema.optional(),
});
export type ShareCreateInput = z.infer<typeof shareCreateSchema>;

export const userSearchQuerySchema = z.object({
  q: z.string().min(1).max(100),
});

export type ShareView = {
  id: string;
  grantee: { id: string; displayName: string | null; email: string };
  access: 'VIEW' | 'EDIT';
  expiresAt: string | null;
  createdById: string;
  createdAt: string;
};

/** Present on a folder/note that is directly shared with the current user. */
export type SharedWithMe = {
  shareId: string;
  sharedByName: string;
  access: 'VIEW' | 'EDIT';
  /** ISO timestamp the grantee first opened the resource, or null. */
  seenAt: string | null;
};

/** A public-link token: 256 bits of CSPRNG entropy, base64url-encoded — see ADR 0028. */
export const publicLinkTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{40,48}$/, 'invalid public-link token');

/** Body of POST /api/notes/[id]/public-link — only an optional expiry. */
export const publicLinkCreateSchema = z.object({
  ttl: shareTtlSchema.optional(),
});
export type PublicLinkCreateInput = z.infer<typeof publicLinkCreateSchema>;

/** A note's public link, as returned to a user who can manage it. */
export type PublicLinkView = {
  id: string;
  token: string;
  /** Absolute viewer URL, e.g. `https://host/p/<token>`. */
  url: string;
  expiresAt: string | null;
  createdAt: string;
};

export type UserSearchHit = { id: string; displayName: string | null; email: string };

/** Body of PUT /api/users/me/theme — one of the closed theme ids (ADR 0029). */
export const userThemeSchema = z.object({
  theme: z.enum(THEME_IDS),
});
export type UserThemeInput = z.infer<typeof userThemeSchema>;

/** Query params for `POST /api/notes/[id]/assets` — the raw file is the body. */
export const assetUploadQuerySchema = z.object({
  filename: z.string().min(1).max(FILENAME_MAX),
});
export type AssetUploadQuery = z.infer<typeof assetUploadQuerySchema>;

/** Body for `PATCH /api/assets/[id]` — updates the searchable caption. */
export const patchCaptionSchema = z.object({
  caption: z.string().max(CAPTION_MAX),
});
export type PatchCaptionInput = z.infer<typeof patchCaptionSchema>;
