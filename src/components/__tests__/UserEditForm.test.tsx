/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminContext, ResourceContextProvider } from 'react-admin';
import { useFormContext } from 'react-hook-form';
import { QueryClient } from '@tanstack/react-query';

const notify = vi.fn();
const redirect = vi.fn();
vi.mock('react-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-admin')>()),
  useNotify: () => notify,
  useRedirect: () => redirect,
}));
// react-admin loads react-hook-form through CJS; share that instance so the form context is common.
vi.mock('react-hook-form', async () => {
  const { createRequire } = await import('node:module');
  return { ...createRequire(import.meta.url)('react-hook-form') };
});
vi.mock('@tanstack/react-query', async () => {
  const { createRequire } = await import('node:module');
  return { ...createRequire(import.meta.url)('@tanstack/react-query') };
});
// Editors seed the form like the real ones do; a customer form must not even mount them.
const Seeder = ({ field, v }: { field: string; v: number[] }) => {
  const { setValue } = useFormContext();
  React.useEffect(() => setValue(field, v, { shouldDirty: false }), []);
  return <div>{field}</div>;
};
vi.mock('../../ui/ManageOrganizations', () => ({ default: () => <Seeder field='organizationArray' v={[1]} /> }));
vi.mock('../../ui/ManageRoles', () => ({ default: () => <Seeder field='roleArray' v={[2]} /> }));
vi.mock('../../ui/ManagePermissions', () => ({ default: () => <Seeder field='permissionArray' v={[3]} /> }));
vi.mock('../../ui/ChangePasswordButton', () => ({ default: () => null }));
vi.mock('../../ui/DeleteUserButton', () => ({ default: () => null }));

import { UserEdit } from '../user';

const order: string[] = [];
beforeEach(() => {
  order.length = 0;
  notify.mockClear();
  redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const MAPPINGS = ['organizationArray', 'roleArray', 'permissionArray'];

const setup = async (account: any, opts: { put?: { ok: boolean; body: any }; accountLoads?: boolean } = {}) => {
  const put = vi.fn();
  const accountGets = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: any) => {
      const json = (ok: boolean, body: any) => ({ ok, json: async () => body });
      if (init?.method === 'PUT') {
        order.push('put');
        put(url, JSON.parse(init.body));
        return json(opts.put?.ok ?? true, opts.put?.body ?? {});
      }
      if (url.includes('/org-settings')) return json(true, { data: [{ orgId: 1, isCustomer: true, permissionSetId: 9 }] });
      accountGets();
      return opts.accountLoads === false ? json(false, { message: 'down' }) : json(true, account);
    }),
  );
  const dp: any = {
    getOne: vi.fn(async () => ({ data: { 'id': 5, 'email': 'a@example.com', 'username': 'u', 'jwt secret': 'x' } })),
    getList: vi.fn(async (r: string) =>
      r === 'organization'
        ? { data: [{ id: 1, name: 'Acme' }], total: 1 }
        : r === 'permission-sets'
          ? { data: [{ id: 7, name: 'Operator' }], total: 1 }
          : { data: [], total: 0 },
    ),
    getMany: vi.fn(async () => ({ data: [] })),
    getManyReference: vi.fn(async () => ({ data: [], total: 0 })),
    update: vi.fn(async (_r: string, p: any) => {
      order.push('update');
      return { data: { ...p.data, id: 5 } };
    }),
    create: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  };
  const queryClient = new QueryClient();
  render(
    <AdminContext dataProvider={dp} queryClient={queryClient as any}>
      <ResourceContextProvider value='user'>
        <UserEdit id={5} redirect={false} />
      </ResourceContextProvider>
    </AdminContext>,
  );
  const email = await screen.findByDisplayValue('a@example.com');
  if (opts.accountLoads !== false) await screen.findByText(/^(Admin UI permission set|Customer org)$/);
  return { dp, put, accountGets, email, queryClient };
};

const save = () => fireEvent.click(screen.getByRole('button', { name: /^(ra\.action\.)?save$/i }));
const pickOption = async (combo: HTMLElement, name: string) => {
  fireEvent.mouseDown(combo);
  fireEvent.click(await screen.findByRole('option', { name }));
};

describe('UserEdit single Save', () => {
  it('has no separate account type button', async () => {
    await setup({ type: 'internal', permissionSetId: null });
    expect(screen.queryByRole('button', { name: /save account type/i })).not.toBeInTheDocument();
  });

  it('customer: mapping arrays absent from the submitted data, no account PUT', async () => {
    const { dp, put, email } = await setup({ type: 'customer', orgId: 1, effectivePermissionSetId: 2 });
    fireEvent.change(email, { target: { value: 'new@example.com' } });
    save();
    await waitFor(() => expect(dp.update).toHaveBeenCalled());
    const data = dp.update.mock.calls[0][1].data;
    expect(data.email).toBe('new@example.com');
    for (const f of MAPPINGS) expect(data).not.toHaveProperty(f);
    expect(data).not.toHaveProperty('accountChoice');
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('list', 'user'));
    expect(put).not.toHaveBeenCalled();
  });

  it('only the account type changed: user update, then account PUT, one success notification', async () => {
    const { dp, put } = await setup({ type: 'internal', permissionSetId: null });
    await pickOption(await screen.findByRole('combobox', { name: /permission set/i }), 'Operator');
    save();
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(order).toEqual(['update', 'put']);
    expect(put.mock.calls[0][0]).toBe('/api/admin/users/5/account');
    expect(put.mock.calls[0][1]).toEqual({ type: 'internal', permissionSetId: 7 });
    expect(dp.update.mock.calls[0][1].data).not.toHaveProperty('accountChoice');
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('list', 'user'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toMatchObject({ type: 'info' });
  });

  it('unchanged account type: no account PUT', async () => {
    const { dp, put, email } = await setup({ type: 'internal', permissionSetId: null });
    fireEvent.change(email, { target: { value: 'x@example.com' } });
    save();
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(dp.update).toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('account PUT failure: error names the account type, no redirect, account reloaded', async () => {
    const { put, accountGets } = await setup(
      { type: 'internal', permissionSetId: null },
      { put: { ok: false, body: { message: 'sync failed' } } },
    );
    const before = accountGets.mock.calls.length;
    await pickOption(await screen.findByRole('combobox', { name: /permission set/i }), 'Operator');
    save();
    await waitFor(() => expect(put).toHaveBeenCalled());
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('User saved, but account type was not: sync failed', { type: 'error' }),
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
    await waitFor(() => expect(accountGets.mock.calls.length).toBe(before + 1));
  });

  it('internal -> customer: no mapping arrays are sent, account PUT follows', async () => {
    const { dp, put } = await setup({ type: 'internal', permissionSetId: null });
    await waitFor(() => expect(screen.getByText('organizationArray')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'Customer' }));
    const combo = await screen.findByRole('combobox', { name: /customer org/i });
    await waitFor(() => expect(combo).not.toHaveAttribute('aria-disabled', 'true'));
    await pickOption(combo, 'Acme');
    save();
    await waitFor(() => expect(put).toHaveBeenCalled());
    const data = dp.update.mock.calls[0][1].data;
    for (const f of MAPPINGS) expect(data).not.toHaveProperty(f);
    expect(put.mock.calls[0][1]).toEqual({ type: 'customer', orgId: 1 });
    expect(order).toEqual(['update', 'put']);
  });

  it('customer without an org selected blocks the save', async () => {
    const { dp, put } = await setup({ type: 'internal', permissionSetId: null });
    fireEvent.click(screen.getByRole('radio', { name: 'Customer' }));
    await screen.findByRole('combobox', { name: /customer org/i });
    save();
    await screen.findByText('Select a customer org');
    expect(dp.update).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('account failed to load: user saves without mappings and without an account PUT', async () => {
    const { dp, put, email } = await setup(null, { accountLoads: false });
    fireEvent.change(email, { target: { value: 'z@example.com' } });
    save();
    await waitFor(() => expect(dp.update).toHaveBeenCalled());
    for (const f of MAPPINGS) expect(dp.update.mock.calls[0][1].data).not.toHaveProperty(f);
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(put).not.toHaveBeenCalled();
  });

  it('a record refetch resets the form: the account field is re-seeded and Save still works', async () => {
    const { dp, put, queryClient } = await setup({ type: 'internal', permissionSetId: null });
    const getOnes = dp.getOne.mock.calls.length;
    dp.getOne.mockImplementation(async () => ({
      data: { 'id': 5, 'email': 'b@example.com', 'username': 'u', 'jwt secret': 'x' },
    }));
    await queryClient.invalidateQueries();
    await screen.findByDisplayValue('b@example.com');
    expect(dp.getOne.mock.calls.length).toBeGreaterThan(getOnes);
    await pickOption(await screen.findByRole('combobox', { name: /permission set/i }), 'Operator');
    save();
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][1]).toEqual({ type: 'internal', permissionSetId: 7 });
  });
});
