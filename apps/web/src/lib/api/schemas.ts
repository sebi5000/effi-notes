import { z } from 'zod';

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
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type PatchNoteInput = z.infer<typeof patchNoteSchema>;

export const putNoteBodySchema = z.object({
  body: z.string().max(BODY_MAX),
  // Optimistic-concurrency token from the last GET. Server rejects with 409
  // if the note has changed since.
  baseUpdatedAt: z.iso.datetime(),
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
  folderId: string | null;
  authorId: string;
  archivedAt: string | null;
  updatedAt: string;
  tags: Array<{ id: string; name: string; color: string | null }>;
};

export type NoteDetail = NoteListItem & {
  body: string;
  createdAt: string;
  lastEditorId: string | null;
};

export type FolderNode = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
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

/** Query params for `POST /api/notes/[noteId]/assets` — the raw file is the body. */
export const assetUploadQuerySchema = z.object({
  filename: z.string().min(1).max(FILENAME_MAX),
});
export type AssetUploadQuery = z.infer<typeof assetUploadQuerySchema>;

/** Body for `PATCH /api/assets/[id]` — updates the searchable caption. */
export const patchCaptionSchema = z.object({
  caption: z.string().max(CAPTION_MAX),
});
export type PatchCaptionInput = z.infer<typeof patchCaptionSchema>;
