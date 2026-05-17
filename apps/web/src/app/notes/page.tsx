import { prisma } from '@app/db';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { auth } from '@/auth';
import { NotesShell } from '@/components/notes/NotesShell.tsx';
import { listAccessibleScope } from '@/lib/notes/access.ts';
import { toSnippet } from '@/lib/notes/snippet.ts';

const PRESENCE_COLORS = ['#C26A20', '#7C3F00', '#4B5066', '#1E2230', '#A03A2B', '#9B6A2F'] as const;

const hashToColor = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length] ?? '#C26A20';
};

export default async function NotesIndexPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?from=/notes');

  const scope = await listAccessibleScope(session.user.id);

  // A share counts toward the badge only while still active (no expiry, or not yet expired).
  const activeShareWhere = { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };

  const [folders, tags, notes] = await Promise.all([
    prisma.folder.findMany({
      where: { id: { in: scope.accessibleFolderIds } },
      select: {
        id: true,
        name: true,
        parentId: true,
        position: true,
        icon: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { shares: { where: activeShareWhere } } },
      },
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { name: 'asc' }],
    }),
    prisma.tag.findMany({
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
    prisma.note.findMany({
      where: {
        AND: [
          { archivedAt: null },
          {
            OR: [
              { authorId: session.user.id },
              { folderId: { in: scope.accessibleFolderIds } },
              { id: { in: scope.sharedNoteIds } },
            ],
          },
        ],
      },
      select: {
        id: true,
        title: true,
        body: true,
        folderId: true,
        authorId: true,
        archivedAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        _count: { select: { shares: { where: activeShareWhere } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
  ]);

  return (
    <Suspense fallback={null}>
      <NotesShell
        folders={folders.map(({ _count, ...f }) => ({
          ...f,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
          shareCount: _count.shares,
        }))}
        tags={tags}
        initialNotes={notes.map((n) => ({
          id: n.id,
          title: n.title,
          snippet: toSnippet(n.body),
          folderId: n.folderId,
          authorId: n.authorId,
          archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
          updatedAt: n.updatedAt.toISOString(),
          tags: n.tags.map((t) => t.tag),
          shareCount: n._count.shares,
        }))}
        currentUser={{
          id: session.user.id,
          name: session.user.displayName ?? session.user.email,
          color: hashToColor(session.user.id),
        }}
        initialNote={null}
      />
    </Suspense>
  );
}
