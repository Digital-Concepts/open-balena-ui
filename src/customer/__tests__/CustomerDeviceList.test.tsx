import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

let capabilities: string[] = [];
vi.mock('react-admin', () => {
  const Stub = (name: string) => ({ label }: any) => <span data-testid={name}>{label}</span>;
  return {
    List: ({ children }: any) => <div>{children}</div>,
    Datagrid: ({ children }: any) => (
      <div>
        {React.Children.map(children, (c: any) => (c?.props?.label !== undefined ? <th data-testid='col'>{c.props.label}</th> : null))}
        {React.Children.map(children, (c: any) => (c?.props?.label === undefined ? c : null))}
      </div>
    ),
    Toolbar: ({ children }: any) => <div data-testid='toolbar'>{children}</div>,
    WithRecord: ({ render }: any) => render({ id: 1, uuid: 'abc' }),
    ShowButton: () => <button>show</button>,
    ReferenceField: Stub('ref'),
    TextField: Stub('text'),
    FunctionField: Stub('fn'),
    SearchInput: Stub('search'),
    Pagination: Stub('pagination'),
    useGetList: () => ({ data: [] }),
    useListContext: () => ({ filterValues: {}, setFilters: vi.fn() }),
    usePermissions: () => ({ permissions: { status: 'ok', me: { userId: 1, permissionSet: { id: 1, name: 'c' }, capabilities } } }),
  };
});
vi.mock('../../components/device', () => ({ OnlineField: Stub2('online'), ReleaseField: Stub2('release') }));
function Stub2(name: string) {
  return ({ label }: any) => <span data-testid={name}>{label}</span>;
}
vi.mock('../../ui/DeviceServicesButton', () => ({ default: () => <button>services</button> }));
vi.mock('../../ui/DeviceConnectButton', () => ({ default: () => <button>connect</button> }));
vi.mock('../widgets/CustomerDeviceConnect', () => ({ default: () => null }));
vi.mock('../widgets/CustomerDeviceServices', () => ({ default: () => null }));

import { CustomerDeviceList } from '../CustomerDeviceList';

describe('CustomerDeviceList', () => {
  it('has the admin columns without Client, Edit or Delete', () => {
    capabilities = ['device.read'];
    render(<CustomerDeviceList />);
    expect(screen.getAllByTestId('col').map((c) => c.textContent)).toEqual([
      'Name', 'Status', 'VPN Status', 'IP Address', 'Current Release', 'Notes', 'Fleet',
    ]);
    expect(screen.queryByText(/client|edit|delete/i)).toBeNull();
  });

  it('shows Services with device.read and Connect only with device.terminal', () => {
    capabilities = ['device.read'];
    const { unmount } = render(<CustomerDeviceList />);
    expect(screen.queryByText('services')).not.toBeNull();
    expect(screen.queryByText('connect')).toBeNull();
    unmount();
    capabilities = ['device.read', 'device.terminal'];
    render(<CustomerDeviceList />);
    expect(screen.queryByText('connect')).not.toBeNull();
  });
});
