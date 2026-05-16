import { prisma } from '@app/db';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { auth } from '@/auth';
import { NotesShell } from '@/components/notes/NotesShell.tsx';

const PRESENCE_COLORS = ['#C26A20', '#7C3F00', '#4B5066', '#1E2230', '#A03A2B', '#9B6A2F'] as const;

const hashToColor = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length] ?? '#C26A20';
};

export default async function NoteDetailPage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?from=/notes/${noteId}`);

  const [folders, tags, notes, note] = await Promise.all([
    prisma.folder.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
        position: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { name: 'asc' }],
    }),
    prisma.tag.findMany({
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
    prisma.note.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        title: true,
        folderId: true,
        authorId: true,
        archivedAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
    prisma.note.findUnique({
      where: { id: noteId },
      select: {
        id: true,
        title: true,
        body: true,
        folderId: true,
        authorId: true,
        lastEditorId: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      },
    }),
  ]);

  if (!note) notFound();

  return (
    <Suspense fallback={null}>
      <NotesShell
        folders={folders.map((f) => ({
          ...f,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
        }))}
        tags={tags}
        initialNotes={notes.map((n) => ({
          id: n.id,
          title: n.title,
          folderId: n.folderId,
          authorId: n.authorId,
          archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
          updatedAt: n.updatedAt.toISOString(),
          tags: n.tags.map((t) => t.tag),
          shareCount: 0,
        }))}
        currentUser={{
          id: session.user.id,
          name: session.user.displayName ?? session.user.email,
          color: hashToColor(session.user.id),
        }}
        initialNote={{
          id: note.id,
          title: note.title,
          body: note.body,
          folderId: note.folderId,
          authorId: note.authorId,
          lastEditorId: note.lastEditorId,
          archivedAt: note.archivedAt ? note.archivedAt.toISOString() : null,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
          tags: note.tags.map((t) => t.tag),
          shareCount: 0,
        }}
      />
    </Suspense>
  );
}
