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
import { GET, POST } from './route.ts';

const mockedAuth = vi.mocked(auth);
const setAuthed = (u: Parameters<typeof authedAs>[1]) => authedAs(mockedAuth, u);
const setUnauthed = () => unauthed(mockedAuth);

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  mockedAuth.mockReset();
  await cleanupNotesDomain();
});
afterAll(async () => {
  await cleanupNotesDomain();
  await prisma.$disconnect();
});

describe('GET /api/notes/[id]/appointments', () => {
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await GET(new Request('http://localhost/x'), ctx('x'));
    expect(res.status).toBe(401);
  });

  it('404 when the note is not visible to the caller', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await GET(new Request('http://localhost/x'), ctx('missing-note'));
    expect(res.status).toBe(404);
  });

  it('lists snapshot rows for any viewer with access', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await makeTestNote({ authorId: user.id });
    await prisma.appointmentLink.create({
      data: {
        noteId: note.id,
        eventId: 'evt-1',
        subject: 'Q4 Review',
        linkedById: user.id,
        startsAt: new Date('2026-06-01T09:00:00Z'),
      },
    });
    const res = await GET(new Request('http://localhost/x'), ctx(note.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      appointments: Array<{ eventId: string; subject: string; startsAt: string | null }>;
    };
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0]?.eventId).toBe('evt-1');
    expect(body.appointments[0]?.subject).toBe('Q4 Review');
    expect(body.appointments[0]?.startsAt).toBe('2026-06-01T09:00:00.000Z');
  });
});

describe('POST /api/notes/[id]/appointments — auth + access checks', () => {
  // The happy path requires a working Graph call (would touch
  // login.microsoftonline.com). Those are covered by the
  // microsoft/tokens.test.ts unit + an end-to-end manual run. Here we lock
  // in the upstream guards so a regression there is caught fast.
  it('401 when unauthenticated', async () => {
    setUnauthed();
    const res = await POST(
      new Request('http://localhost/x', {
        method: 'POST',
        body: JSON.stringify({ eventId: 'evt-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      ctx('x'),
    );
    expect(res.status).toBe(401);
  });

  it('404 when the note does not exist', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const res = await POST(
      new Request('http://localhost/x', {
        method: 'POST',
        body: JSON.stringify({ eventId: 'evt-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      ctx('missing-note'),
    );
    expect(res.status).toBe(404);
  });

  it('400 on missing eventId', async () => {
    const { user } = await makeTestUser();
    setAuthed(user);
    const note = await makeTestNote({ authorId: user.id });
    const res = await POST(
      new Request('http://localhost/x', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
      ctx(note.id),
    );
    expect(res.status).toBe(400);
  });
});
