import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

let capabilities: string[] = [];
vi.mock('react-admin', () => ({
  useRecordContext: () => ({ uuid: 'abc', 'device name': 'gw', 'is running-release': 50 }),
  useNotify: () => vi.fn(),
  useList: ({ data }: any) => ({ data }),
  ListContextProvider: ({ value, children }: any) => <div data-rows={value.data.length}>{children}</div>,
  Datagrid: ({ children }: any) => <div>{children}</div>,
  FunctionField: ({ label, render }: any) => (label ? null : <div>{render({ id: 77, imageId: 77, serviceName: 'core', status: 'Running' })}</div>),
  ReferenceField: () => null,
  Toolbar: ({ children }: any) => <div>{children}</div>,
  WithRecord: () => null,
  usePermissions: () => ({ permissions: { status: 'ok', me: { userId: 1, permissionSet: { id: 1, name: 'c' }, capabilities } } }),
}));
vi.mock('../api', () => ({
  customerApi: vi.fn(async () => [
    { imageId: 77, serviceId: 2, serviceName: 'core', releaseId: 50, status: 'Running' },
    { imageId: 78, serviceId: 3, serviceName: 'old', releaseId: 49, status: 'Running' },
  ]),
}));
vi.mock('../../ui/SemVerChip', () => ({ default: () => null }));

import CustomerDeviceServices from '../widgets/CustomerDeviceServices';

describe('CustomerDeviceServices gating', () => {
  it('shows only the running release services, without controls for device.read', async () => {
    capabilities = ['device.read'];
    render(<CustomerDeviceServices />);
    await waitFor(() => expect(document.querySelector('[data-rows="1"]')).not.toBeNull());
    expect(screen.queryByLabelText('restart core')).toBeNull();
  });

  it('shows start/stop/restart with device.actions', async () => {
    capabilities = ['device.read', 'device.actions'];
    render(<CustomerDeviceServices />);
    await waitFor(() => expect(screen.queryByLabelText('restart core')).not.toBeNull());
    expect(screen.queryByLabelText('start core')).not.toBeNull();
    expect(screen.queryByLabelText('stop core')).not.toBeNull();
  });
});
