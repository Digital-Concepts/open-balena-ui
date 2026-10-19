import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AdminContext } from 'react-admin';
import { QueryClient } from '@tanstack/react-query';
// react-admin loads react-query through CJS; share that instance so the QueryClient context is common.
vi.mock('@tanstack/react-query', async () => {
  const { createRequire } = await import('node:module');
  return { ...createRequire(import.meta.url)('@tanstack/react-query') };
});

vi.mock('react-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-admin')>()),
  useRedirect: () => vi.fn(),
  useNotify: () => vi.fn(),
}));

import { assignDefaultRole, guardMappings, useDeleteUser, useDeleteUserBulk, useModifyUser, useUserCreated } from '../user';
import { afterEach } from 'vitest';

describe('assignDefaultRole', () => {
  it('creates user-has-role when the role exists', async () => {
    const dp: any = {
      getList: vi.fn(async () => ({ data: [{ id: 7, name: 'default-user' }] })),
      create: vi.fn(async () => ({ data: {} })),
    };
    expect(await assignDefaultRole(dp, 42)).toBeNull();
    expect(dp.create).toHaveBeenCalledWith('user-has-role', { data: { user: 42, role: 7 } });
  });
  it('returns an error naming the role when it is missing', async () => {
    const dp: any = { getList: vi.fn(async () => ({ data: [] })), create: vi.fn() };
    const msg = await assignDefaultRole(dp, 42);
    expect(msg).toContain('default-user');
    expect(msg).toContain('Access → Users → Roles');
    expect(dp.create).not.toHaveBeenCalled();
  });
  it('returns an error when the insert fails', async () => {
    const dp: any = {
      getList: vi.fn(async () => ({ data: [{ id: 7, name: 'default-user' }] })),
      create: vi.fn(async () => {
        throw new Error('x');
      }),
    };
    expect(await assignDefaultRole(dp, 42)).toContain('default-user');
  });
});

describe('useModifyUser', () => {
  const setup = () => {
    const dp: any = {
      getList: vi.fn(async () => ({
        data: [{ 'id': 99, 'user': 5, 'role': 7, 'permission': 3, 'is member of-organization': 2 }],
      })),
      create: vi.fn(async () => ({ data: {} })),
      delete: vi.fn(async () => ({ data: {} })),
    };
    const queryClient: any = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: any) =>
      React.createElement(AdminContext, { dataProvider: dp, queryClient }, children);
    const { result } = renderHook(() => useModifyUser(), { wrapper });
    return { dp, spy, run: result.current };
  };

  it('skips a mapping whose array was never seeded (no deletes)', async () => {
    const { dp, run } = setup();
    await run({ id: 5 });
    expect(dp.delete).not.toHaveBeenCalled();
    expect(dp.create).not.toHaveBeenCalled();
  });

  it('still syncs a seeded mapping', async () => {
    const { dp, run } = setup();
    await run({ id: 5, roleArray: [] });
    expect(dp.delete).toHaveBeenCalledWith('user-has-role', { id: 99 });
    expect(dp.delete).toHaveBeenCalledTimes(1);
  });

  it('invalidates the three mapping caches after saving', async () => {
    const { spy, run } = setup();
    await run({ id: 5, roleArray: [7], permissionArray: [3], organizationArray: [2] });
    const keys = spy.mock.calls.map((c: any) => c[0].queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(['user-has-role', 'user-has-permission', 'organization membership']));
  });
});

describe('useUserCreated', () => {
  it('invalidates user-has-role after the default role is assigned', async () => {
    const dp: any = {
      getList: vi.fn(async () => ({ data: [{ id: 7, name: 'default-user' }] })),
      create: vi.fn(async () => ({ data: {} })),
    };
    const queryClient: any = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: any) =>
      React.createElement(AdminContext, { dataProvider: dp, queryClient }, children);
    const { result } = renderHook(() => useUserCreated(), { wrapper });
    await result.current({ id: 5 });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['user-has-role'] });
  });
});

describe('guardMappings', () => {
  const data = () => ({ id: 5, email: 'a', organizationArray: [1], roleArray: [2], permissionArray: [3] });
  it('strips mapping arrays unless the account is internal', () => {
    for (const t of ['customer', null]) {
      expect(guardMappings(t, data())).toEqual({ id: 5, email: 'a' });
    }
    expect(guardMappings('internal', data())).toEqual(data());
  });
  it('a stripped payload makes modifyUser skip every mapping', async () => {
    const dp: any = { getList: vi.fn(), create: vi.fn(), delete: vi.fn() };
    const queryClient: any = new QueryClient();
    const wrapper = ({ children }: any) =>
      React.createElement(AdminContext, { dataProvider: dp, queryClient }, children);
    const { result } = renderHook(() => useModifyUser(), { wrapper });
    await result.current(guardMappings('customer', data()));
    expect(dp.getList).not.toHaveBeenCalled();
    expect(dp.delete).not.toHaveBeenCalled();
  });
});

describe('useUserCreated account routes', () => {
  afterEach(() => vi.unstubAllGlobals());
  const setup = (choice: any, put = vi.fn(async () => ({ ok: true, json: async () => ({}) }))) => {
    vi.stubGlobal('fetch', put);
    const dp: any = {
      getList: vi.fn(async () => ({ data: [{ id: 7, name: 'default-user' }] })),
      create: vi.fn(async () => ({ data: {} })),
    };
    const queryClient: any = new QueryClient();
    const wrapper = ({ children }: any) =>
      React.createElement(AdminContext, { dataProvider: dp, queryClient }, children);
    const { result } = renderHook(() => useUserCreated(() => choice), { wrapper });
    return { dp, put, run: result.current };
  };

  it('customer: PUTs the account and skips the default role', async () => {
    const { dp, put, run } = setup({ type: 'customer', orgId: '3', permissionSetId: '' });
    await run({ id: 5 });
    expect(put).toHaveBeenCalledWith('/api/admin/users/5/account', expect.objectContaining({ method: 'PUT' }));
    expect(JSON.parse((put.mock.calls[0] as any)[1].body)).toEqual({ type: 'customer', orgId: 3 });
    expect(dp.create).not.toHaveBeenCalled();
  });
  it('internal: failed default role still saves the chosen set and lists what failed', async () => {
    const { dp, put, run } = setup({ type: 'internal', orgId: '', permissionSetId: '9' });
    dp.getList = vi.fn(async () => ({ data: [] }));
    await run({ id: 5 });
    expect(put).toHaveBeenCalled();
  });
  it('internal: default role, and PUT only when a set is chosen', async () => {
    const a = setup({ type: 'internal', orgId: '', permissionSetId: '' });
    await a.run({ id: 5 });
    expect(a.dp.create).toHaveBeenCalledWith('user-has-role', { data: { user: 5, role: 7 } });
    expect(a.put).not.toHaveBeenCalled();
    const b = setup({ type: 'internal', orgId: '', permissionSetId: '9' });
    await b.run({ id: 6 });
    expect(JSON.parse((b.put.mock.calls[0] as any)[1].body)).toEqual({ type: 'internal', permissionSetId: 9 });
  });
});

describe('protected openBalena users', () => {
  const setup = (users: any[]) => {
    const dp: any = {
      getList: vi.fn(async () => ({ data: [] })),
      getMany: vi.fn(async () => ({ data: users })),
      delete: vi.fn(async () => ({ data: {} })),
      deleteMany: vi.fn(async () => ({ data: [] })),
    };
    const wrapper = ({ children }: any) =>
      React.createElement(AdminContext, { dataProvider: dp, queryClient: new QueryClient() as any }, children);
    const { result } = renderHook(() => ({ one: useDeleteUser(), bulk: useDeleteUserBulk() }), { wrapper });
    return { dp, ...result.current };
  };

  it('refuses to delete guest before touching anything', async () => {
    const { dp, one } = setup([]);
    await expect(one({ id: 1, actor: 2, username: 'guest' })).rejects.toThrow('system user');
    expect(dp.getList).not.toHaveBeenCalled();
    expect(dp.delete).not.toHaveBeenCalled();
  });
  it('refuses a bulk delete that includes guest, deleting nobody', async () => {
    const { dp, bulk } = setup([
      { id: 5, actor: 6, username: 'test1' },
      { id: 1, actor: 2, username: 'guest' },
    ]);
    await expect(bulk([5, 1])).rejects.toThrow('"guest"');
    expect(dp.getList).not.toHaveBeenCalled();
    expect(dp.delete).not.toHaveBeenCalled();
  });
  it('still deletes normal users', async () => {
    const { dp, one } = setup([]);
    await one({ id: 5, actor: 6, username: 'test1' });
    expect(dp.delete).toHaveBeenCalledWith('user', { id: 5 });
  });
});
