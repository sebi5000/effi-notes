'use client';

import { useCallback, useEffect, useReducer } from 'react';
import type { PublicLinkCreateInput, PublicLinkView, ShareTtl } from '@/lib/api/schemas.ts';
import { ApiError, publicLinkApi } from '@/lib/notes/api-client.ts';

type UsePublicLinkResult = {
  link: PublicLinkView | null;
  loading: boolean;
  error: string | null;
  /** (Re)generate the link — regenerating replaces the previous token. */
  generate: (input?: PublicLinkCreateInput) => Promise<void>;
  /** Update just the expiry of an existing link without changing the token. */
  updateExpiry: (ttl: ShareTtl | null) => Promise<void>;
  /** Revoke the link, if any. */
  revoke: () => Promise<void>;
};

type State = {
  link: PublicLinkView | null;
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: 'START' }
  | { type: 'SUCCESS'; link: PublicLinkView | null }
  | { type: 'ERROR'; error: string };

const initialState: State = { link: null, loading: true, error: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START':
      return { ...state, loading: true, error: null };
    case 'SUCCESS':
      return { link: action.link, loading: false, error: null };
    case 'ERROR':
      return { ...state, loading: false, error: action.error };
  }
}

const errorMessage = (err: unknown): string =>
  err instanceof ApiError ? err.message : 'Unknown error';

/**
 * Manages a note's public link (ADR 0028). Fetches on mount; `generate`
 * (re)creates it, `revoke` deletes it. Accepts an optional `fetcher` for tests.
 */
export function usePublicLink(noteId: string, fetcher?: typeof fetch): UsePublicLinkResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  const load = useCallback(async () => {
    dispatch({ type: 'START' });
    try {
      const res = await publicLinkApi.get(noteId, fetcher);
      dispatch({ type: 'SUCCESS', link: res.link });
    } catch (err) {
      dispatch({ type: 'ERROR', error: errorMessage(err) });
    }
  }, [noteId, fetcher]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = useCallback(
    async (input: PublicLinkCreateInput = {}) => {
      dispatch({ type: 'START' });
      try {
        const link = await publicLinkApi.create(noteId, input, fetcher);
        dispatch({ type: 'SUCCESS', link });
      } catch (err) {
        dispatch({ type: 'ERROR', error: errorMessage(err) });
      }
    },
    [noteId, fetcher],
  );

  const updateExpiry = useCallback(
    async (ttl: ShareTtl | null) => {
      dispatch({ type: 'START' });
      try {
        const link = await publicLinkApi.update(noteId, { ttl }, fetcher);
        dispatch({ type: 'SUCCESS', link });
      } catch (err) {
        dispatch({ type: 'ERROR', error: errorMessage(err) });
      }
    },
    [noteId, fetcher],
  );

  const revoke = useCallback(async () => {
    dispatch({ type: 'START' });
    try {
      await publicLinkApi.revoke(noteId, fetcher);
      dispatch({ type: 'SUCCESS', link: null });
    } catch (err) {
      dispatch({ type: 'ERROR', error: errorMessage(err) });
    }
  }, [noteId, fetcher]);

  return {
    link: state.link,
    loading: state.loading,
    error: state.error,
    generate,
    updateExpiry,
    revoke,
  };
}
