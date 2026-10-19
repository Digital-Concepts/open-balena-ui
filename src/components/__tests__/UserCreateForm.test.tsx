/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminContext, ResourceContextProvider } from 'react-admin';
import { QueryClient } from '@tanstack/react-query';

vi.mock('@tanstack/react-query', async () => {
  const { createRequire } = await import('node:module');
  return { ...createRequire(import.meta.url)('@tanstack/react-query') };
});

import { UserCreate } from '../user';

afterEach(() => vi.unstubAllGlobals());

describe('UserCreate customer gating', () => {
  it('customer Save stays disabled while customer orgs fail to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    const dp: any = {
      getList: vi.fn(async () => ({ data: [], total: 0 })),
      getMany: vi.fn(async () => ({ data: [] })),
    };
    render(
      <AdminContext dataProvider={dp} queryClient={new QueryClient() as any}>
        <ResourceContextProvider value='user'>
          <UserCreate />
        </ResourceContextProvider>
      </AdminContext>,
    );
    fireEvent.click(await screen.findByRole('radio', { name: 'Customer' }));
    await screen.findByText('Could not load customer orgs — reload the page');
    expect(screen.getByRole('button', { name: /^(ra\.action\.)?save$/i })).toBeDisabled();
  });
});
