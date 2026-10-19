import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { AdminContext, Resource, AdminUI } from 'react-admin';
import { QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const adminFetch = vi.fn();
vi.mock('../../lib/adminApi', () => ({ adminFetch: (...a: any[]) => adminFetch(...a) }));

import { AuditList, formatDetails } from '../audit';

const rows = [
  { id: 2, ts: '2026-10-19T10:00:00.000Z', userId: 1, username: 'alice', orgId: 1, orgName: 'Acme', fleetId: 7, fleetName: 'Fleet A', deviceUuid: 'aaa', deviceName: 'dev-a', action: 'tag.create', details: { key: 'site' }, result: 'ok', error: null },
  { id: 1, ts: '2026-10-19T09:00:00.000Z', userId: 1, username: 'alice', orgId: 1, orgName: 'Acme', fleetId: 7, fleetName: 'Fleet A', deviceUuid: 'gone', deviceName: 'dev-gone', action: 'device.reboot', details: null, result: 'failed', error: 'balena down' },
];

const setup = () => {
  const auditList = vi.fn(async (_p: any) => ({ data: rows, total: 2 }));
  const deviceList = vi.fn(async (_p: any) => ({ data: [{ id: 42, uuid: 'aaa' }], total: 1 }));
  const dataProvider: any = {
    getList: (resource: string, params: any) => (resource === 'audit' ? auditList(params) : deviceList(params)),
    getMany: async () => ({ data: [] }),
    getManyReference: async () => ({ data: [], total: 0 }),
  };
  render(
    <MemoryRouter initialEntries={['/audit']}>
      <AdminContext dataProvider={dataProvider} queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } }) as any}>
        <AdminUI>
          <Resource name='audit' list={AuditList} />
          <Resource name='device' />
        </AdminUI>
      </AdminContext>
    </MemoryRouter>,
  );
  return { auditList, deviceList };
};

describe('AuditList', () => {
  beforeEach(() => {
    adminFetch.mockReset();
    adminFetch.mockResolvedValue({
      ok: true,
      body: { users: [{ id: 1, username: 'alice' }], fleets: [{ id: 7, name: 'Fleet A' }], actions: ['tag.create', 'device.reboot'] },
    });
  });

  it('formats details compactly', () => {
    expect(formatDetails(null)).toBe('');
    expect(formatDetails({ key: 'site', n: 2, names: ['a'] })).toBe('key: site, n: 2, names: ["a"]');
  });

  it('renders rows with labels, device link and result', async () => {
    const { auditList, deviceList } = setup();
    await waitFor(() => expect(screen.getByText('Create tag')).toBeTruthy());
    expect(screen.getByText('Reboot device')).toBeTruthy();
    expect(auditList.mock.calls[0][0].pagination).toEqual({ page: 1, perPage: 25 });
    await waitFor(() => expect(screen.getByText('dev-a').closest('a')?.getAttribute('href')).toContain('/device/42/show'));
    expect(screen.getByText('dev-gone').closest('a')).toBeNull();
    expect(deviceList).toHaveBeenCalledTimes(1);
    expect(deviceList.mock.calls[0][0].filter).toEqual({ 'uuid@in': '(aaa,gone)' });
    expect(screen.getByLabelText('ok')).toBeTruthy();
    expect(screen.getByLabelText('failed')).toBeTruthy();
    expect(screen.getByText('key: site')).toBeTruthy();
  });

  it('passes filters to the list call', async () => {
    const { auditList } = setup();
    await waitFor(() => expect(screen.getByText('Create tag')).toBeTruthy());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Fleet' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Fleet A' }));
    await waitFor(() => expect(auditList.mock.calls.some((c) => c[0].filter?.fleetId === 7)).toBe(true));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'User' }));
    fireEvent.click(await screen.findByRole('option', { name: 'alice' }));
    await waitFor(() => expect(auditList.mock.calls.some((c) => c[0].filter?.userId === 1 && c[0].filter?.fleetId === 7)).toBe(true));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Action' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Create tag' }));
    await waitFor(() =>
      expect(auditList.mock.calls.some((c) => c[0].filter?.action === 'tag.create' && c[0].filter?.userId === 1)).toBe(true),
    );
  });

  it('survives a failing filters request', async () => {
    adminFetch.mockRejectedValue(new Error('net'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    await waitFor(() => expect(screen.getByText('Create tag')).toBeTruthy());
    await waitFor(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
  });
});
