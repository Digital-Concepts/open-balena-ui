import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('react-admin', () => ({
  useGetList: () => ({
    data: [
      { id: 1, name: 'Acme' },
      { id: 2, name: 'Other' },
    ],
  }),
}));

import { useCustomerOrgs } from '../useCustomerOrgs';

afterEach(() => vi.unstubAllGlobals());

describe('useCustomerOrgs', () => {
  it('one request, only customer orgs', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { orgId: 1, isCustomer: true, permissionSetId: 9 },
          { orgId: 2, isCustomer: false, permissionSetId: null },
        ],
      }),
    }));
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useCustomerOrgs());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.orgs).toEqual([{ id: 1, name: 'Acme' }]);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('error when the settings request fails or is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    const a = renderHook(() => useCustomerOrgs());
    await waitFor(() => expect(a.result.current.status).toBe('error'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    const b = renderHook(() => useCustomerOrgs());
    await waitFor(() => expect(b.result.current.status).toBe('error'));
  });
});
