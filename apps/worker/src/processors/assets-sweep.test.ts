import { prisma } from '@app/db';
import type { Job } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { processAssetsSweep } from './assets-sweep.ts';

const TEST_PREFIX = 'assets-sweep-';

const cleanup = async () => {
  await prisma.asset.deleteMany({
    where: { note: { author: { email: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.note.deleteMany({ where: { author: { email: { startsWith: TEST_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
  // The sweep writes an `assets.swept` audit row with a null actorId, so it is
  // not cleared by the user cascade above — drop it explicitly to isolate runs.
  await prisma.auditLog.deleteMany({ where: { action: 'assets.swept' } });
};

const seedAsset = async (unreferencedSince: Date | null) => {
  const user = await prisma.user.create({
    data: {
      keycloakSub: `${TEST_PREFIX}sub-${crypto.randomUUID()}`,
      email: `${TEST_PREFIX}${crypto.randomUUID()}@example.invalid`,
      displayName: 'Sweep',
      roles: ['user'],
    },
  });
  const note = await prisma.note.create({ data: { title: 'sweep-note', authorId: user.id } });
  return prisma.asset.create({
    data: {
      noteId: note.id,
      authorId: user.id,
      kind: 'IMAGE',
      contentType: 'image/png',
      filename: 'a.png',
      byteSize: 8,
      data: Buffer.from('%PNG'),
      unreferencedSince,
    },
  });
};

const fakeJob = (): Job =>
  ({ id: crypto.randomUUID(), data: {}, log: async () => undefined }) as unknown as Job;

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('processAssetsSweep', () => {
  it('deletes assets unreferenced longer than the grace period', async () => {
    const old = await seedAsset(new Date(Date.now() - 25 * 60 * 60 * 1000));
    await processAssetsSweep(fakeJob());
    expect(await prisma.asset.findUnique({ where: { id: old.id } })).toBeNull();

    const auditRow = await prisma.auditLog.findFirst({ where: { action: 'assets.swept' } });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.metadata).toMatchObject({ count: 1 });
  });

  it('keeps assets unreferenced within the grace period', async () => {
    const recent = await seedAsset(new Date(Date.now() - 60 * 1000));
    await processAssetsSweep(fakeJob());
    expect(await prisma.asset.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });

  it('keeps referenced assets (unreferencedSince null)', async () => {
    const live = await seedAsset(null);
    await processAssetsSweep(fakeJob());
    expect(await prisma.asset.findUnique({ where: { id: live.id } })).not.toBeNull();
  });
});
