import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

let capabilities: string[] = [];
vi.mock('react-admin', () => ({
  useRecordContext: () => ({ uuid: 'abc' }),
  useNotify: () => vi.fn(),
  useList: ({ data }: any) => ({ data }),
  ListContextProvider: ({ value, children }: any) => <div data-rows={value.data.length}>{children}</div>,
  Datagrid: ({ children }: any) => <div>{children}</div>,
  FunctionField: () => null,
  Toolbar: ({ children }: any) => <div>{children}</div>,
  WithRecord: ({ render }: any) => render({ id: 8, key: 'site', value: 'A' }),
  usePermissions: () => ({ permissions: { status: 'ok', me: { userId: 1, permissionSet: { id: 1, name: 'c' }, capabilities } } }),
}));
vi.mock('../api', () => ({ customerApi: vi.fn(async () => [{ id: 8, key: 'site', value: 'A' }]) }));
vi.mock('../../ui/CopyChip', () => ({ default: () => null }));

import CustomerTagsWidget from '../widgets/CustomerTagsWidget';

describe('CustomerTagsWidget gating', () => {
  it('offers no write controls with only device.read', async () => {
    capabilities = ['device.read'];
    render(<CustomerTagsWidget />);
    await waitFor(() => expect(document.querySelector('[data-rows="1"]')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /create/i })).toBeNull();
    expect(screen.queryByLabelText('edit tag')).toBeNull();
    expect(screen.queryByLabelText('delete tag')).toBeNull();
  });

  it('shows create/edit with tags.write and delete only with tags.delete', async () => {
    capabilities = ['device.read', 'device.tags.write'];
    const { unmount } = render(<CustomerTagsWidget />);
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeNull();
    expect(screen.queryByLabelText('edit tag')).not.toBeNull();
    expect(screen.queryByLabelText('delete tag')).toBeNull();
    unmount();
    capabilities = ['device.read', 'device.tags.delete'];
    render(<CustomerTagsWidget />);
    expect(screen.queryByLabelText('delete tag')).not.toBeNull();
    expect(screen.queryByLabelText('edit tag')).toBeNull();
  });
});
