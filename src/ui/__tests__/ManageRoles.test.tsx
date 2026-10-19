/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AdminContext, RecordContextProvider } from 'react-admin';
import { QueryClient } from '@tanstack/react-query';

// Share react-query's CJS instance with react-admin.
vi.mock('@tanstack/react-query', async () => {
  const { createRequire } = await import('node:module');
  return { ...createRequire(import.meta.url)('@tanstack/react-query') };
});

// react-admin loads react-hook-form through CJS; share that instance so the form context is common.
vi.mock('react-hook-form', async () => {
  const { createRequire } = await import('node:module');
  return { ...createRequire(import.meta.url)('react-hook-form') };
});

import { useFormContext, FormProvider, useForm } from 'react-hook-form';
import { ManageRoles } from '../ManageRoles';

const Probe: React.FC<{ onValue: (v: unknown) => void }> = ({ onValue }) => {
  const { watch } = useFormContext();
  onValue(watch('roleArray'));
  return null;
};

const Harness: React.FC<{ onValue: (v: unknown) => void }> = ({ onValue }) => {
  const methods = useForm();
  return (
    <FormProvider {...methods}>
      <ManageRoles source='roleArray' reference='user-has-role' target='user' />
      <Probe onValue={onValue} />
    </FormProvider>
  );
};

describe('ManageRoles seeding', () => {
  it('seeds the form from the fresh fetch, not the stale cache', async () => {
    const dataProvider: any = {
      getList: vi.fn(async (resource: string) => {
        if (resource === 'role')
          return {
            data: [
              { id: 1, name: 'a' },
              { id: 2, name: 'b' },
            ],
            total: 2,
          };
        return {
          data: [
            { id: 10, user: 5, role: 1 },
            { id: 11, user: 5, role: 2 },
          ],
          total: 2,
        };
      }),
    };
    // Typed loosely: react-admin's bundled query-core is a separate type instance.
    const queryClient: any = new QueryClient();
    const params = {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { user: 5 },
    };
    // Stale cache from an earlier visit: only role 1, fetched before mount.
    queryClient.setQueryData(
      ['user-has-role', 'getList', params],
      {
        data: [{ id: 10, user: 5, role: 1 }],
        total: 1,
      },
      { updatedAt: Date.now() - 60_000 },
    );

    // The role list is cached too, so the form renders at once from cache (isLoading=false).
    queryClient.setQueryData(
      ['role', 'getList', { ...params, filter: {} }],
      {
        data: [
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
        ],
        total: 2,
      },
      { updatedAt: Date.now() - 60_000 },
    );

    let latest: unknown;
    render(
      <AdminContext dataProvider={dataProvider} queryClient={queryClient}>
        <RecordContextProvider value={{ id: 5 }}>
          <Harness onValue={(v) => (latest = v)} />
        </RecordContextProvider>
      </AdminContext>,
    );

    await waitFor(() => expect(latest).toEqual([1, 2]));
    expect(latest).not.toEqual([1]);
  });
});
