/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import {
  AdminContext,
  RecordContextProvider,
  ResourceContextProvider,
  SaveContextProvider,
  TextInput,
  required,
} from 'react-admin';
const redirect = vi.fn();
const notify = vi.fn();
vi.mock('react-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-admin')>()),
  useRedirect: () => redirect,
  useNotify: () => notify,
}));

// react-admin loads react-hook-form through CJS; share that instance so the form context is common.
vi.mock('react-hook-form', async () => {
  const { createRequire } = await import('node:module');
  return { ...createRequire(import.meta.url)('react-hook-form') };
});

import { OrganizationFleetsForm } from '../ManageOrganizationFleets';
import { OrganizationEdit } from '../../components/organization';

const order: string[] = [];
const update = vi.fn(async (_r: string, p: any) => {
  order.push('update');
  return { data: { id: p.id } };
});
const save = vi.fn(async (values: any, opts: any) => {
  order.push('save');
  await opts?.onSuccess?.({ data: values });
});

const dataProvider: any = {
  getList: async (resource: string) =>
    resource === 'permission-sets'
      ? { data: [{ id: 9, name: 'Operator', capabilities: [] }], total: 1 }
      : resource === 'organization'
      ? {
          data: [
            { id: 1, name: 'Org A' },
            { id: 2, name: 'Org B' },
          ],
          total: 2,
        }
      : {
          data: [
            { 'id': 10, 'app name': 'own', 'organization': 1 },
            { 'id': 11, 'app name': 'foreign', 'organization': 2 },
          ],
          total: 2,
        },
  update,
};

const renderForm = (name = 'Org A') =>
  render(
    <AdminContext dataProvider={dataProvider}>
      <ResourceContextProvider value='organization'>
        <RecordContextProvider value={{ id: 1, name, handle: 'a' }}>
          <SaveContextProvider value={{ save } as any}>
            <OrganizationFleetsForm>
              <TextInput source='name' validate={required()} />
            </OrganizationFleetsForm>
          </SaveContextProvider>
        </RecordContextProvider>
      </ResourceContextProvider>
    </AdminContext>,
  );

const selectForeignAndSave = async () => {
  fireEvent.click(await screen.findByText('foreign (Org B)'));
  fireEvent.click(screen.getByRole('button', { name: /move selected to chosen/i }));
  fireEvent.click(screen.getByRole('button', { name: /action.save/i }));
};

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  order.length = 0;
  update.mockClear();
  save.mockClear();
  redirect.mockClear();
  notify.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('OrganizationFleetsForm failed move', () => {
  it('a rejected fleet update gives one error notification and no redirect', async () => {
    update.mockImplementationOnce(async () => {
      throw new Error('nope');
    });
    renderForm();
    await selectForeignAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Could not assign fleet(s): foreign', { type: 'error' }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('OrganizationEdit with a real Edit', () => {
  const renderEdit = (orgUpdate: (p: any) => Promise<any>) => {
    const calls: string[] = [];
    const dp: any = {
      ...dataProvider,
      getOne: async () => ({ data: { id: 1, name: 'Org A', handle: 'a' } }),
      update: async (resource: string, p: any) => {
        calls.push(resource);
        return resource === 'organization' ? orgUpdate(p) : { data: { id: p.id } };
      },
    };
    render(
      <AdminContext dataProvider={dp}>
        <OrganizationEdit id={1} resource='organization' />
      </AdminContext>,
    );
    return calls;
  };

  it('moves fleets only after the org update has resolved', async () => {
    let resolveOrg: (v: any) => void = () => {};
    const calls = renderEdit(() => new Promise((r) => (resolveOrg = r)));
    await selectForeignAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(calls).toEqual(['organization']));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual(['organization']);
    resolveOrg({ data: { id: 1, name: 'Org A', handle: 'a' } });
    await waitFor(() => expect(calls).toEqual(['organization', 'application']));
  });

  it('a rejected org update never moves a fleet', async () => {
    const calls = renderEdit(async () => {
      throw new Error('org failed');
    });
    await selectForeignAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(calls).toEqual(['organization']));
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toEqual(['organization']);
  });
});

describe('OrganizationFleetsForm', () => {
  it('foreign fleet: Confirm shown first, no update before confirmation', async () => {
    renderForm();
    await selectForeignAndSave();
    expect(await screen.findByText('foreign will leave Org B')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('cancel: nothing is saved or moved', async () => {
    renderForm();
    await selectForeignAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText('foreign will leave Org B')).not.toBeInTheDocument());
    expect(update).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('confirm: org saved first, then the fleet is moved', async () => {
    renderForm();
    await selectForeignAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['save', 'update']);
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('list', 'organization'));
    expect(update.mock.calls[0][0]).toBe('application');
    expect(update.mock.calls[0][1]).toMatchObject({ id: 11, data: { organization: 1 } });
  });

  it('invalid org form: no save and no update', async () => {
    renderForm('');
    await selectForeignAndSave();
    expect(await screen.findByText(/validation.required/)).toBeInTheDocument();
    expect(screen.queryByText('foreign will leave Org B')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('OrganizationEdit single Save with customer settings', () => {
  const settings = { orgId: 1, isCustomer: false, permissionSetId: null, userCount: 0 };
  const customerSetLabel = /customer permission set/i;
  const renderEdit = (putResult: { ok: boolean; body: any } = { ok: true, body: settings }, failFleets = false) => {
    const calls: string[] = [];
    const gets = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: any) => {
        if (init?.method === 'PUT') {
          calls.push('settings');
          calls.push(init.body);
          return { ok: putResult.ok, json: async () => putResult.body };
        }
        gets();
        return { ok: true, json: async () => settings };
      }),
    );
    const dp: any = {
      ...dataProvider,
      getOne: async () => ({ data: { id: 1, name: 'Org A', handle: 'a' } }),
      update: async (resource: string, p: any) => {
        calls.push(resource);
        if (failFleets && resource === 'application') throw new Error('nope');
        return { data: { id: p.id } };
      },
    };
    render(
      <AdminContext dataProvider={dp}>
        <OrganizationEdit id={1} resource='organization' />
      </AdminContext>,
    );
    return Object.assign(calls, { gets });
  };
  const toggle = async () => {
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: customerSetLabel }));
    fireEvent.click(await screen.findByRole('option', { name: 'Operator' }));
  };
  const confirmMove = async () => {
    fireEvent.click(await screen.findByText('foreign (Org B)'));
    fireEvent.click(screen.getByRole('button', { name: /move selected to chosen/i }));
    fireEvent.click(screen.getByRole('button', { name: /action.save/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
  };

  it('has no separate customer settings button and no customer org toggle', async () => {
    renderEdit();
    await screen.findByRole('combobox', { name: customerSetLabel });
    expect(screen.queryByRole('checkbox', { name: /customer org/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save customer settings/i })).not.toBeInTheDocument();
  });

  it('settings change: org update, then settings PUT, then fleet moves', async () => {
    const calls = renderEdit();
    await toggle();
    await confirmMove();
    await waitFor(() => expect(calls).toContain('application'));
    expect(calls.filter((c) => !c.startsWith('{'))).toEqual(['organization', 'settings', 'application']);
    expect(JSON.parse(calls[2])).toEqual({ permissionSetId: 9 });
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('list', 'organization'));
  });

  it('unchanged settings: no settings PUT', async () => {
    const calls = renderEdit();
    await screen.findByRole('combobox', { name: customerSetLabel });
    await confirmMove();
    await waitFor(() => expect(calls).toContain('application'));
    expect(calls).not.toContain('settings');
  });

  it('settings PUT failure: error names the settings, no redirect', async () => {
    const calls = renderEdit({ ok: false, body: { message: '2 users are linked' } });
    await toggle();
    const before = calls.gets.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /action.save/i }));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('Org saved, but customer settings were not: 2 users are linked', {
        type: 'error',
      }),
    );
    expect(calls[0]).toBe('organization');
    expect(redirect).not.toHaveBeenCalled();
    await waitFor(() => expect(calls.gets.mock.calls.length).toBe(before + 1));
  });

  it('settings and fleet both fail: one combined error notification', async () => {
    const calls = renderEdit({ ok: false, body: { message: 'locked' } }, true);
    await toggle();
    await confirmMove();
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        'Org saved, but customer settings (locked) and fleet(s) foreign were not saved.',
        { type: 'error' },
      ),
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(calls).toContain('application');
    expect(redirect).not.toHaveBeenCalled();
  });
});
