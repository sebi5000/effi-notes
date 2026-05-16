'use client';

import { useCallback, useEffect, useReducer } from 'react';
import type { ShareCreateInput, ShareView } from '@/lib/api/schemas.ts';
import { ApiError, sharesApi } from '@/lib/notes/api-client.ts';

type ShareScope = { kind: 'note' | 'folder'; id: string };

type UseSharesResult = {
  shares: ShareView[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (input: ShareCreateInput) => Promise<void>;
  revoke: (shareId: string) => Promise<void>;
};

type State = {
  shares: ShareView[];
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; shares: ShareView[] }
  | { type: 'FETCH_ERROR'; error: string };

const initialState: State = { shares: [], loading: true, error: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
      return { shares: action.shares, loading: false, error: null };
    case 'FETCH_ERROR':
      return { shares: [], loading: false, error: action.error };
  }
}

/**
 * Manages share state for a note or folder. Fetches the list on mount and
 * after every mutating operation. Accepts an optional `fetcher` for testing.
 */
export function useShares(scope: ShareScope, fetcher?: typeof fetch): UseSharesResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  const fetchShares = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const res = await sharesApi.list(scope, fetcher);
      dispatch({ type: 'FETCH_SUCCESS', shares: res.shares });
    } catch (err) {
      dispatch({
        type: 'FETCH_ERROR',
        error: err instanceof ApiError ? err.message : 'Unknown error',
      });
    }
  }, [scope, fetcher]);

  useEffect(() => {
    void fetchShares();
  }, [fetchShares]);

  const reload = useCallback(async () => {
    await fetchShares();
  }, [fetchShares]);

  const create = useCallback(
    async (input: ShareCreateInput) => {
      await sharesApi.create(scope, input, fetcher);
      await fetchShares();
    },
    [scope, fetcher, fetchShares],
  );

  const revoke = useCallback(
    async (shareId: string) => {
      await sharesApi.revoke(scope, shareId, fetcher);
      await fetchShares();
    },
    [scope, fetcher, fetchShares],
  );

  return {
    shares: state.shares,
    loading: state.loading,
    error: state.error,
    reload,
    create,
    revoke,
  };
}
