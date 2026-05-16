import { prisma } from '@app/db';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

const cleanup = async () => {
  await prisma.asset.deleteMany({ where: { filename: { startsWith: 'schematest-' } } });
  await prisma.note.deleteMany({ where: { title: { startsWith: 'schematest-' } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'schematest-' } } });
};

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Asset model', () => {
  it('stores bytes and is retrievable, and cascade-deletes with its note', async () => {
    const user = await prisma.user.create({
      data: {
        keycloakSub: `schematest-${Date.now()}`,
        email: `schematest-${Date.now()}@x.invalid`,
      },
    });
    const note = await prisma.note.create({
      data: { title: 'schematest-note', authorId: user.id },
    });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'schematest-pic.png',
        byteSize: bytes.byteLength,
        data: bytes,
      },
    });

    const loaded = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(loaded?.contentType).toBe('image/png');
    expect(loaded?.caption).toBe('');
    expect(Buffer.from(loaded?.data ?? []).equals(bytes)).toBe(true);

    await prisma.note.delete({ where: { id: note.id } });
    expect(await prisma.asset.findUnique({ where: { id: asset.id } })).toBeNull();
  });

  it('round-trips the PDF preview columns', async () => {
    const user = await prisma.user.create({
      data: {
        keycloakSub: `schematest-${Date.now()}-pdf`,
        email: `schematest-${Date.now()}-pdf@x.invalid`,
      },
    });
    const note = await prisma.note.create({
      data: { title: 'schematest-pdf-note', authorId: user.id },
    });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'PDF',
        contentType: 'application/pdf',
        filename: 'schematest-doc.pdf',
        byteSize: 1024,
        data: Buffer.from('%PDF-1.4'),
        previewImage: png,
        previewContentType: 'image/png',
        pageCount: 3,
      },
    });
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.pageCount).toBe(3);
    expect(reloaded.previewContentType).toBe('image/png');
    expect(Buffer.from(reloaded.previewImage ?? []).equals(png)).toBe(true);
    // unreferencedSince defaults to null when not provided
    expect(reloaded.unreferencedSince).toBeNull();
  });

  it('round-trips the unreferencedSince column', async () => {
    const user = await prisma.user.create({
      data: {
        keycloakSub: `schematest-${Date.now()}-unref`,
        email: `schematest-${Date.now()}-unref@x.invalid`,
      },
    });
    const note = await prisma.note.create({
      data: { title: 'schematest-unref-note', authorId: user.id },
    });
    const when = new Date('2026-05-16T10:00:00.000Z');
    const asset = await prisma.asset.create({
      data: {
        noteId: note.id,
        authorId: user.id,
        kind: 'IMAGE',
        contentType: 'image/png',
        filename: 'schematest-x.png',
        byteSize: 8,
        data: Buffer.from('%PNG'),
        unreferencedSince: when,
      },
    });
    const reloaded = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.unreferencedSince?.getTime()).toBe(when.getTime());
  });
});
