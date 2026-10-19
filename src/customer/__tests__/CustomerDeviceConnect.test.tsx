import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

const customerApi = vi.fn(async (path: string, _init?: any): Promise<any> =>
  path.endsWith('/connect') ? { uuid: 'abc', username: 'u', containers: [] } : {},
);
vi.mock('../api', () => ({ customerApi: (p: string, i?: any) => customerApi(p, i) }));
vi.mock('micro-key-producer/ssh.js', () => ({ default: () => ({ publicKey: 'PUB', privateKey: 'PRIV' }) }));
vi.mock('micro-key-producer/utils.js', () => ({ randomBytes: () => new Uint8Array(32) }));
vi.mock('../../ui/EmbeddedFrame', () => ({ EmbeddedFrame: () => null }));
vi.mock('@mui/material', () => ({ Box: (p: any) => <div>{p.children}</div>, useTheme: () => ({ palette: { mode: 'light' } }) }));
vi.mock('react-admin', () => ({
  useRecordContext: () => ({ uuid: 'abc' }),
  useNotify: () => vi.fn(),
  Form: (p: any) => <form>{p.children}</form>,
  SelectInput: (p: any) => (
    <select data-testid='sel' onChange={p.onChange}>
      <option value='default' />
      {p.choices.map((c: any) => (
        <option key={c.value} value={c.value}>{c.label}</option>
      ))}
    </select>
  ),
}));

import CustomerDeviceConnect from '../widgets/CustomerDeviceConnect';
import { fireEvent } from '@testing-library/react';

describe('CustomerDeviceConnect', () => {
  it('sends deviceUuid with the ssh key', async () => {
    render(<CustomerDeviceConnect />);
    await waitFor(() => expect(screen.getByText('host - SSH')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sel'), { target: { value: '__host__' } });
    await waitFor(() => expect(customerApi.mock.calls.some((c) => c[0] === '/ssh-key')).toBe(true));
    const call = customerApi.mock.calls.find((c) => c[0] === '/ssh-key')!;
    expect(JSON.parse(call[1].body)).toEqual({ publicKey: 'PUB', deviceUuid: 'abc' });
  });
});
