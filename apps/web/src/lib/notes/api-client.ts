import type {
  CreateFolderInput,
  CreateNoteInput,
  CreateTagInput,
  FolderNode,
  NoteDetail,
  NoteListItem,
  PatchFolderInput,
  PatchNoteInput,
  PublicLinkCreateInput,
  PublicLinkUpdateInput,
  PublicLinkView,
  PutNoteBodyInput,
  SearchHit,
  ShareCreateInput,
  ShareView,
  TagItem,
  UserSearchHit,
} from '@/lib/api/schemas.ts';

/**
 * Typed fetch wrappers around the REST API. Server components can read
 * directly from Prisma; the client uses this module.
 *
 * Errors come back as ApiError thrown from the helper — the caller decides
 * whether to retry, surface a toast, or fall through.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = 'ApiError';
  }
}

const request = async <T>(
  url: string,
  init: RequestInit & { fetcher?: typeof fetch } = {},
): Promise<T> => {
  const { fetcher, ...rest } = init;
  const f = fetcher ?? fetch;
  const res = await f(url, {
    headers: { 'content-type': 'application/json', ...rest.headers },
    ...rest,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore — non-JSON error
    }
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  return (await res.json()) as T;
};

export const notesApi = {
  list: (
    query: {
      folderId?: string;
      tagId?: string;
      q?: string;
      includeArchived?: boolean;
      /** `shared` → only notes shared directly with the caller. */
      section?: 'shared';
    } = {},
    fetcher?: typeof fetch,
  ): Promise<{ notes: NoteListItem[] }> => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      sp.set(k, String(v));
    }
    const qs = sp.toString();
    const url = qs ? `/api/notes?${qs}` : '/api/notes';
    return request(url, fetcher ? { fetcher } : {});
  },
  get: (id: string, fetcher?: typeof fetch): Promise<NoteDetail> =>
    request(`/api/notes/${id}`, fetcher ? { fetcher } : {}),
  create: (input: CreateNoteInput, fetcher?: typeof fetch): Promise<NoteListItem> =>
    request('/api/notes', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
  patch: (id: string, input: PatchNoteInput, fetcher?: typeof fetch): Promise<NoteDetail> =>
    request(`/api/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
  archive: (id: string, fetcher?: typeof fetch): Promise<{ archived: true }> =>
    request(`/api/notes/${id}`, { method: 'DELETE', ...(fetcher ? { fetcher } : {}) }),
  delete: (id: string, fetcher?: typeof fetch): Promise<{ deleted: true }> =>
    request(`/api/notes/${id}?hard=1`, { method: 'DELETE', ...(fetcher ? { fetcher } : {}) }),
  putBody: (
    id: string,
    input: PutNoteBodyInput,
    fetcher?: typeof fetch,
  ): Promise<{ id: string; updatedAt: string; bodyVersion: number }> =>
    request(`/api/notes/${id}/body`, {
      method: 'PUT',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
  duplicate: (id: string, fetcher?: typeof fetch): Promise<NoteListItem> =>
    request(`/api/notes/${id}/duplicate`, {
      method: 'POST',
      ...(fetcher ? { fetcher } : {}),
    }),
};

export const foldersApi = {
  list: (fetcher?: typeof fetch): Promise<{ folders: FolderNode[] }> =>
    request('/api/folders', fetcher ? { fetcher } : {}),
  create: (input: CreateFolderInput, fetcher?: typeof fetch): Promise<FolderNode> =>
    request('/api/folders', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
  patch: (id: string, input: PatchFolderInput, fetcher?: typeof fetch): Promise<FolderNode> =>
    request(`/api/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
  delete: (id: string, fetcher?: typeof fetch): Promise<{ deleted: true }> =>
    request(`/api/folders/${id}`, {
      method: 'DELETE',
      ...(fetcher ? { fetcher } : {}),
    }),
  reorder: (
    parentId: string | null,
    orderedIds: ReadonlyArray<string>,
    fetcher?: typeof fetch,
  ): Promise<{ reordered: number }> =>
    request('/api/folders/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ parentId, orderedIds }),
      ...(fetcher ? { fetcher } : {}),
    }),
};

export const tagsApi = {
  list: (fetcher?: typeof fetch): Promise<{ tags: TagItem[] }> =>
    request('/api/tags', fetcher ? { fetcher } : {}),
  create: (input: CreateTagInput, fetcher?: typeof fetch): Promise<TagItem> =>
    request('/api/tags', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
};

export const searchApi = {
  query: (
    q: string,
    limit = 20,
    fetcher?: typeof fetch,
  ): Promise<{ hits: SearchHit[]; total: number }> => {
    const sp = new URLSearchParams({ q, limit: String(limit) });
    return request(`/api/search?${sp}`, fetcher ? { fetcher } : {});
  },
};

export const collabApi = {
  issueToken: (
    noteId: string,
    fetcher?: typeof fetch,
  ): Promise<{ url: string; token: string; expiresAt: string }> =>
    request(`/api/collab/${noteId}`, fetcher ? { fetcher } : {}),
};

type ShareScope = { kind: 'note' | 'folder'; id: string };

const sharesBase = (s: ShareScope): string =>
  s.kind === 'note' ? `/api/notes/${s.id}/shares` : `/api/folders/${s.id}/shares`;

export const sharesApi = {
  list: (scope: ShareScope, fetcher?: typeof fetch): Promise<{ shares: ShareView[] }> =>
    request(sharesBase(scope), fetcher ? { fetcher } : {}),
  create: (
    scope: ShareScope,
    input: ShareCreateInput,
    fetcher?: typeof fetch,
  ): Promise<ShareView> =>
    request(sharesBase(scope), {
      method: 'POST',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
  revoke: (
    scope: ShareScope,
    shareId: string,
    fetcher?: typeof fetch,
  ): Promise<{ revoked: true }> =>
    request(`${sharesBase(scope)}/${shareId}`, {
      method: 'DELETE',
      ...(fetcher ? { fetcher } : {}),
    }),
  markSeen: (shareId: string, fetcher?: typeof fetch): Promise<{ marked: true }> =>
    request(`/api/shares/${shareId}/seen`, {
      method: 'POST',
      ...(fetcher ? { fetcher } : {}),
    }),
};

export const usersApi = {
  search: (q: string, fetcher?: typeof fetch): Promise<{ users: UserSearchHit[] }> =>
    request(`/api/users?q=${encodeURIComponent(q)}`, fetcher ? { fetcher } : {}),
};

/** Manage a note's account-less public link (ADR 0028). */
export const publicLinkApi = {
  get: (noteId: string, fetcher?: typeof fetch): Promise<{ link: PublicLinkView | null }> =>
    request(`/api/notes/${noteId}/public-link`, fetcher ? { fetcher } : {}),
  create: (
    noteId: string,
    input: PublicLinkCreateInput,
    fetcher?: typeof fetch,
  ): Promise<PublicLinkView> =>
    request(`/api/notes/${noteId}/public-link`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
  /** Update only the expiry — the token is preserved, so the URL stays valid. */
  update: (
    noteId: string,
    input: PublicLinkUpdateInput,
    fetcher?: typeof fetch,
  ): Promise<PublicLinkView> =>
    request(`/api/notes/${noteId}/public-link`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      ...(fetcher ? { fetcher } : {}),
    }),
  revoke: (noteId: string, fetcher?: typeof fetch): Promise<{ revoked: boolean }> =>
    request(`/api/notes/${noteId}/public-link`, {
      method: 'DELETE',
      ...(fetcher ? { fetcher } : {}),
    }),
};

export const assetsApi = {
  /** Uploads a file as a note asset. Returns the new asset's id + serve URL. */
  upload: async (
    noteId: string,
    file: File,
    fetcher?: typeof fetch,
  ): Promise<{ id: string; url: string }> => {
    const f = fetcher ?? fetch;
    const res = await f(`/api/notes/${noteId}/assets?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
    });
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // non-JSON error response
      }
      const message =
        typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new ApiError(res.status, message, body);
    }
    return (await res.json()) as { id: string; url: string };
  },

  /** Updates an asset's searchable caption. */
  patchCaption: (
    id: string,
    caption: string,
    fetcher?: typeof fetch,
  ): Promise<{ id: string; caption: string }> =>
    request(`/api/assets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ caption }),
      ...(fetcher ? { fetcher } : {}),
    }),
};
