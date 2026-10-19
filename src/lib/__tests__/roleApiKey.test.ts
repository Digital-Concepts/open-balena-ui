import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AdminContext } from 'react-admin';
import { QueryClient } from '@tanstack/react-query';

// Share react-query's CJS instance with react-admin.
vi.mock('@tanstack/react-query', async () => {
  const { createRequire } = await import('node:module');
  return { ...createRequire(import.meta.url)('@tanstack/react-query') };
});

import { useModifyRole } from '../role';
import { useModifyApiKey } from '../apiKey';

const setup = (hook: () => (d: any) => Promise<any>) => {
  const dp: any = {
    getList: vi.fn(async () => ({ data: [{ 'id': 99, 'role': 1, 'api key': 5, 'permission': 3 }] })),
    create: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  };
  const queryClient: any = new QueryClient();
  const spy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: any) => React.createElement(AdminContext, { dataProvider: dp, queryClient }, children);
  const { result } = renderHook(hook, { wrapper });
  return { dp, spy, run: result.current };
};

const keys = (spy: any) => spy.mock.calls.map((c: any) => c[0].queryKey[0]);

describe('useModifyRole', () => {
  it('skips an unseeded permissionArray (no deletes)', async () => {
    const { dp, run } = setup(useModifyRole);
    await run({ id: 1 });
    expect(dp.delete).not.toHaveBeenCalled();
    expect(dp.create).not.toHaveBeenCalled();
  });
  it('syncs a seeded array and invalidates role-has-permission', async () => {
    const { dp, spy, run } = setup(useModifyRole);
    await run({ id: 1, permissionArray: [] });
    expect(dp.delete).toHaveBeenCalledWith('role-has-permission', { id: 99 });
    expect(keys(spy)).toContain('role-has-permission');
  });
});

describe('useModifyApiKey', () => {
  it('skips unseeded arrays (no deletes)', async () => {
    const { dp, run } = setup(useModifyApiKey);
    await run({ id: 5 });
    expect(dp.delete).not.toHaveBeenCalled();
  });
  it('syncs seeded arrays and invalidates both mappings', async () => {
    const { dp, spy, run } = setup(useModifyApiKey);
    await run({ id: 5, roleArray: [], permissionArray: [] });
    expect(dp.delete).toHaveBeenCalledTimes(2);
    expect(keys(spy)).toEqual(expect.arrayContaining(['api key-has-role', 'api key-has-permission']));
  });
});
