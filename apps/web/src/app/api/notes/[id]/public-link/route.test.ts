import { vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

import { prisma } from '@app/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '@/auth';
import {
  authedAs,
  cleanupNotesDomain,
  makeTestNote,
  makeTestUser,
  unauthed,
} from '@/lib/api/test-session.ts';
import { DELETE, GET, PATCH, POST } from './route.ts';

const mockedAuth = vi.mocked(auth);
const setAuthed = (u: Parameters<typeof authedAs>[1]) => authedAs(mockedAuth, u);
const setUnauthed = () => unauthed(mockedAuth);

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const postReq = (body: unknown = {}) =>
  new Request('http://localhost/api/notes/x/public-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/notes/[id]/public-link', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await GET(new Request('http://localhost/x'), ctx('x'));
    expect(res.status).toBe(401);
  });

  it('404 when the note does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/x'), ctx('does-not-exist'));
    expect(res.status).toBe(404);
  });

  it("403 when the caller cannot manage the note's shares", async () => {
    const { user: owner } = await makeTestUser();
    const { user: other } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    setAuthed(other);
    const res = await GET(new Request('http://localhost/x'), ctx(note.id));
    expect(res.status).toBe(403);
  });

  it('returns { link: null } when no public link exists', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    const res = await GET(new Request('http://localhost/x'), ctx(note.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { link: unknown }).link).toBeNull();
  });
});

describe('POST /api/notes/[id]/public-link', () => {
  it('generates a public link and writes an audit row', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    const res = await POST(postReq(), ctx(note.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      token: string;
      url: string;
      expiresAt: string | null;
    };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,48}$/);
    expect(body.url).toBe(`/p/${body.token}`);
    expect(body.expiresAt).toBeNull();

    // Scope by subject — auditLog is not cleaned between tests.
    const audits = await prisma.auditLog.findMany({
      where: { action: 'publicLink.created', subject: body.id },
    });
    expect(audits.length).toBe(1);
  });

  it('honours an optional TTL', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    const res = await POST(postReq({ ttl: { value: 2, unit: 'hours' } }), ctx(note.id));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { expiresAt: string | null }).expiresAt).not.toBeNull();
  });

  it('regenerating replaces the previous token', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    const first = (await (await POST(postReq(), ctx(note.id))).json()) as { token: string };
    const second = (await (await POST(postReq(), ctx(note.id))).json()) as { token: string };
    expect(second.token).not.toBe(first.token);
    expect(await prisma.publicLink.count({ where: { noteId: note.id } })).toBe(1);
  });

  it('403 for a caller who cannot manage the note', async () => {
    const { user: owner } = await makeTestUser();
    const { user: other } = await makeTestUser();
    const note = await makeTestNote({ authorId: owner.id });
    setAuthed(other);
    const res = await POST(postReq(), ctx(note.id));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/notes/[id]/public-link', () => {
  const patchReq = (body: unknown) =>
    new Request('http://localhost/api/notes/x/public-link', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await PATCH(patchReq({ ttl: null }), ctx('x'));
    expect(res.status).toBe(401);
  });

  it('404 when no public link exists', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    const res = await PATCH(patchReq({ ttl: null }), ctx(note.id));
    expect(res.status).toBe(404);
  });

  it('400 on missing ttl field', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    await POST(postReq(), ctx(note.id));
    const res = await PATCH(patchReq({}), ctx(note.id));
    expect(res.status).toBe(400);
  });

  it('extends the expiry without changing the token', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    const created = (await (await POST(postReq(), ctx(note.id))).json()) as {
      token: string;
      expiresAt: string | null;
    };
    expect(created.expiresAt).toBeNull();

    const res = await PATCH(patchReq({ ttl: { value: 1, unit: 'hours' } }), ctx(note.id));
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { token: string; expiresAt: string | null };
    expect(updated.token).toBe(created.token); // token preserved
    expect(updated.expiresAt).not.toBeNull();
  });

  it('clears the expiry when ttl is null', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    await POST(postReq({ ttl: { value: 2, unit: 'hours' } }), ctx(note.id));

    const res = await PATCH(patchReq({ ttl: null }), ctx(note.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { expiresAt: string | null }).expiresAt).toBeNull();
  });
});

describe('DELETE /api/notes/[id]/public-link', () => {
  it('revokes the link and writes an audit row', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    const created = (await (await POST(postReq(), ctx(note.id))).json()) as { id: string };

    const res = await DELETE(new Request('http://localhost/x'), ctx(note.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { revoked: boolean }).revoked).toBe(true);
    expect(await prisma.publicLink.count({ where: { noteId: note.id } })).toBe(0);

    // Scope by subject — auditLog is not cleaned between tests.
    const audits = await prisma.auditLog.findMany({
      where: { action: 'publicLink.revoked', subject: created.id },
    });
    expect(audits.length).toBe(1);
  });

  it('is a no-op (revoked: false) when there is no link', async () => {
    const { user } = await makeTestUser();
    const note = await makeTestNote({ authorId: user.id });
    setAuthed(user);
    const res = await DELETE(new Request('http://localhost/x'), ctx(note.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { revoked: boolean }).revoked).toBe(false);
  });
});
