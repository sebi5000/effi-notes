import { prisma } from '@app/db';
import { publicLinkTokenSchema } from '@/lib/api/schemas.ts';

/**
 * Public-note resolution (ADR 0028).
 *
 * This is the token-based read path — a deliberate sibling to `access.ts`,
 * which stays the single authorisation source for *authenticated* access. A
 * public link confers no `Access` level; it resolves a token to a read-only
 * note projection or to `null`.
 */

export type PublicNoteTag = { name: string; color: string | null };

/** A note as exposed through a public link — no author, folder, or ids. */
export type PublicNoteView = {
  title: string;
  /** Latest CRDT snapshot, or null when the note was never opened in the editor. */
  yjsState: Uint8Array | null;
  /** Plain-text body mirror — the renderer's fallback when `yjsState` is null. */
  body: string;
  updatedAt: Date;
  tags: PublicNoteTag[];
};

/**
 * Resolve a public-link token to a read-only note projection, or `null` when
 * the token is malformed, unknown, expired, or points at an archived note.
 *
 * Every failure mode collapses to `null` so callers render a single 404 with
 * no oracle distinguishing "never existed" from "expired" or "revoked".
 */
export const resolvePublicNote = async (token: string): Promise<PublicNoteView | null> => {
  if (!publicLinkTokenSchema.safeParse(token).success) return null;

  const link = await prisma.publicLink.findUnique({
    where: { token },
    select: {
      expiresAt: true,
      note: {
        select: {
          title: true,
          yjsState: true,
          body: true,
          updatedAt: true,
          archivedAt: true,
          tags: { select: { tag: { select: { name: true, color: true } } } },
        },
      },
    },
  });
  if (link === null) return null;
  // Lazy expiry — identical to Share (ADR 0026); no sweep job.
  if (link.expiresAt !== null && link.expiresAt.getTime() <= Date.now()) return null;
  if (link.note.archivedAt !== null) return null;

  return {
    title: link.note.title,
    yjsState: link.note.yjsState === null ? null : new Uint8Array(link.note.yjsState),
    body: link.note.body,
    updatedAt: link.note.updatedAt,
    tags: link.note.tags.map((t) => ({ name: t.tag.name, color: t.tag.color })),
  };
};

/**
 * Resolve a public-link token to the underlying note id, honouring expiry —
 * used by the public asset route to scope which assets it may serve. Returns
 * `null` for the same failure set as `resolvePublicNote`.
 */
export const resolvePublicNoteId = async (token: string): Promise<string | null> => {
  if (!publicLinkTokenSchema.safeParse(token).success) return null;

  const link = await prisma.publicLink.findUnique({
    where: { token },
    select: { expiresAt: true, noteId: true, note: { select: { archivedAt: true } } },
  });
  if (link === null) return null;
  if (link.expiresAt !== null && link.expiresAt.getTime() <= Date.now()) return null;
  if (link.note.archivedAt !== null) return null;
  return link.noteId;
};
