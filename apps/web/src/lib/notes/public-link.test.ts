import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupNotesDomain, makeTestNote, makeTestUser } from '@/lib/api/test-session.ts';
import { resolvePublicNote, resolvePublicNoteId } from './public-link.ts';
import { generatePublicToken } from './public-link-token.ts';

beforeEach(async () => {
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('resolvePublicNote', () => {
  it('returns the note projection for a valid token', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id, title: 'api-test-public', body: 'hello' });
    const token = generatePublicToken();
    await prisma.publicLink.create({ data: { token, noteId: note.id, createdById: user.id } });

    const view = await resolvePublicNote(token);
    expect(view?.title).toBe('api-test-public');
    expect(view?.body).toBe('hello');
  });

  it('returns null for an unknown token', async () => {
    expect(await resolvePublicNote(generatePublicToken())).toBeNull();
  });

  it('returns null for a malformed token', async () => {
    expect(await resolvePublicNote('not-a-token')).toBeNull();
  });

  it('returns null for an expired link', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    const token = generatePublicToken();
    await prisma.publicLink.create({
      data: {
        token,
        noteId: note.id,
        createdById: user.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect(await resolvePublicNote(token)).toBeNull();
  });

  it('returns null when the note is archived', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    await prisma.note.update({ where: { id: note.id }, data: { archivedAt: new Date() } });
    const token = generatePublicToken();
    await prisma.publicLink.create({ data: { token, noteId: note.id, createdById: user.id } });
    expect(await resolvePublicNote(token)).toBeNull();
  });
});

describe('resolvePublicNoteId', () => {
  it('returns the note id for a valid token, null for an expired one', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    const live = generatePublicToken();
    await prisma.publicLink.create({
      data: { token: live, noteId: note.id, createdById: user.id },
    });
    expect(await resolvePublicNoteId(live)).toBe(note.id);

    const note2 = await makeTestNote({ authorId: user.id });
    const dead = generatePublicToken();
    await prisma.publicLink.create({
      data: {
        token: dead,
        noteId: note2.id,
        createdById: user.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect(await resolvePublicNoteId(dead)).toBeNull();
  });
});
