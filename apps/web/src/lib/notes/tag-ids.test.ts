import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveTagIds } from './tag-ids.ts';

const cleanup = async () => {
  // Tag rows live independently of users; only delete the rows this test
  // suite owns (by name prefix) so we don't trample concurrent tests.
  await prisma.tag.deleteMany({ where: { name: { startsWith: 'tag-ids-test-' } } });
};

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('resolveTagIds', () => {
  it('returns an empty list unchanged', async () => {
    const r = await resolveTagIds([]);
    expect(r).toEqual({ ok: true, tagIds: [] });
  });

  it('de-duplicates while preserving first-seen order', async () => {
    const a = await prisma.tag.create({ data: { name: 'tag-ids-test-a' } });
    const b = await prisma.tag.create({ data: { name: 'tag-ids-test-b' } });
    const r = await resolveTagIds([a.id, b.id, a.id, b.id]);
    expect(r).toEqual({ ok: true, tagIds: [a.id, b.id] });
  });

  it('reports unknown ids when any do not exist', async () => {
    const a = await prisma.tag.create({ data: { name: 'tag-ids-test-known' } });
    const r = await resolveTagIds([a.id, 'made-up-id-1', 'made-up-id-2']);
    expect(r).toEqual({ ok: false, unknown: ['made-up-id-1', 'made-up-id-2'] });
  });

  it('treats every id as unknown when the table is empty for these ids', async () => {
    const r = await resolveTagIds(['nope-1', 'nope-2']);
    expect(r).toEqual({ ok: false, unknown: ['nope-1', 'nope-2'] });
  });
});
