import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  assetsApi,
  collabApi,
  foldersApi,
  notesApi,
  searchApi,
  tagsApi,
} from './api-client.ts';

const fakeOk = (body: unknown, status = 200): typeof fetch =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;

const fakeFail = (status: number, body: unknown): typeof fetch =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;

describe('notesApi', () => {
  it('list builds the query string from the supplied filters', async () => {
    const fetcher = fakeOk({ notes: [] });
    await notesApi.list({ folderId: 'f1', q: 'strategy', includeArchived: true }, fetcher);
    const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('folderId=f1');
    expect(url).toContain('q=strategy');
    expect(url).toContain('includeArchived=true');
  });

  it('list with empty filters omits the query string', async () => {
    const fetcher = fakeOk({ notes: [] });
    await notesApi.list({}, fetcher);
    const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('/api/notes');
  });

  it('get fetches a specific note', async () => {
    const fetcher = fakeOk({ id: 'n1', title: 'x' });
    const note = await notesApi.get('n1', fetcher);
    expect(note).toMatchObject({ id: 'n1' });
  });

  it('create POSTs JSON and parses the body', async () => {
    const fetcher = fakeOk({ id: 'n1', title: 'created' }, 201);
    const note = await notesApi.create({ title: 'created' }, fetcher);
    expect(note.title).toBe('created');
    const init = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
  });

  it('archive sends DELETE without ?hard=1', async () => {
    const fetcher = fakeOk({ archived: true });
    await notesApi.archive('n1', fetcher);
    const url = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(url).toBe('/api/notes/n1');
  });

  it('delete (hard) appends ?hard=1', async () => {
    const fetcher = fakeOk({ deleted: true });
    await notesApi.delete('n1', fetcher);
    const url = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(url).toBe('/api/notes/n1?hard=1');
  });

  it('putBody PUTs the markdown', async () => {
    const fetcher = fakeOk({ id: 'n1', updatedAt: '2026-05-14T00:00:00.000Z', bodyVersion: 1 });
    await notesApi.putBody('n1', { body: '#', baseBodyVersion: 0 }, fetcher);
    const init = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(init?.method).toBe('PUT');
  });

  it('throws ApiError on non-2xx with parseable body', async () => {
    const fetcher = fakeFail(400, { error: 'invalid body' });
    await expect(notesApi.create({ title: '' }, fetcher)).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError when the error body is not JSON', async () => {
    const fetcher = vi.fn(
      async () => new Response('not-json', { status: 500 }),
    ) as unknown as typeof fetch;
    try {
      await notesApi.get('n1', fetcher);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });

  it('patches a note', async () => {
    const fetcher = fakeOk({ id: 'n1', title: 'new' });
    await notesApi.patch('n1', { title: 'new' }, fetcher);
    const init = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(init?.method).toBe('PATCH');
  });
});

describe('foldersApi / tagsApi / searchApi / collabApi', () => {
  it('foldersApi.list', async () => {
    const fetcher = fakeOk({ folders: [] });
    await foldersApi.list(fetcher);
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      '/api/folders',
    );
  });
  it('foldersApi.create', async () => {
    const fetcher = fakeOk({ id: 'f1' }, 201);
    const folder = await foldersApi.create({ name: 'x' }, fetcher);
    expect(folder.id).toBe('f1');
  });
  it('tagsApi.list', async () => {
    const fetcher = fakeOk({ tags: [] });
    await tagsApi.list(fetcher);
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('/api/tags');
  });
  it('tagsApi.create', async () => {
    const fetcher = fakeOk({ id: 't1' }, 201);
    await tagsApi.create({ name: 'x' }, fetcher);
    const init = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
  });
  it('searchApi.query', async () => {
    const fetcher = fakeOk({ hits: [], total: 0 });
    await searchApi.query('hi', 10, fetcher);
    const url = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('q=hi');
    expect(url).toContain('limit=10');
  });
  it('collabApi.issueToken', async () => {
    const fetcher = fakeOk({ url: 'ws://x/yjs/n', token: 't', expiresAt: 'x' });
    const out = await collabApi.issueToken('n', fetcher);
    expect(out.url).toContain('/yjs/');
  });
});

describe('assetsApi', () => {
  it('upload posts the file to the note assets endpoint and returns id + url', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: 'a1', url: '/api/assets/a1' }), { status: 201 });
    }) as unknown as typeof fetch;
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    const res = await assetsApi.upload('note1', file, fetcher);
    expect(res).toEqual({ id: 'a1', url: '/api/assets/a1' });
    expect(calls[0]?.url).toBe('/api/notes/note1/assets?filename=pic.png');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(file);
  });

  it('upload throws an ApiError carrying the server message on a non-ok response', async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ error: 'too large' }), {
        status: 413,
      })) as unknown as typeof fetch;
    const file = new File([new Uint8Array([1])], 'big.png', { type: 'image/png' });
    const err = await assetsApi.upload('note1', file, fetcher).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(413);
    expect((err as ApiError).message).toBe('too large');
  });

  it('upload percent-encodes the filename in the query', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: 'a2', url: '/api/assets/a2' }), { status: 201 });
    }) as unknown as typeof fetch;
    const file = new File([new Uint8Array([1])], 'my photo.png', { type: 'image/png' });
    await assetsApi.upload('n1', file, fetcher);
    expect(calls[0]?.url).toBe('/api/notes/n1/assets?filename=my%20photo.png');
  });

  it('patchCaption sends a PATCH with the caption body', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: 'a1', caption: 'hi' }), { status: 200 });
    }) as unknown as typeof fetch;
    await assetsApi.patchCaption('a1', 'hi', fetcher);
    expect(calls[0]?.url).toBe('/api/assets/a1');
    expect(calls[0]?.init?.method).toBe('PATCH');
    expect(String(calls[0]?.init?.body)).toContain('hi');
  });
});
