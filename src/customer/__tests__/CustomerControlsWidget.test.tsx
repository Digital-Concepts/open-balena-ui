import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';

const notify = vi.fn();
let capabilities: string[] = [];
let online = true;
vi.mock('react-admin', () => ({
  useRecordContext: () => ({ id: 1, uuid: 'abc', 'device name': 'gw-1', 'api heartbeat state': online ? 'online' : 'offline' }),
  useNotify: () => notify,
  usePermissions: () => ({ permissions: { status: 'ok', me: { userId: 1, permissionSet: { id: 1, name: 'c' }, capabilities } } }),
  ReferenceField: ({ children }: any) => <span>{children}</span>,
  TextField: () => <span>fleet</span>,
}));
vi.mock('../../components/device', () => ({ OnlineField: () => <span>status</span> }));
const customerApi = vi.fn(async (..._args: any[]) => ({}));
vi.mock('../api', () => ({ customerApi: (...a: any[]) => customerApi(...a) }));

import CustomerControlsWidget from '../widgets/CustomerControlsWidget';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  customerApi.mockClear();
  notify.mockClear();
  online = true;
});

describe('CustomerControlsWidget', () => {
  it('shows no action buttons without device.actions', () => {
    capabilities = ['device.read'];
    render(<CustomerControlsWidget />);
    expect(screen.getByText('gw-1')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers only Reboot with device.actions and posts after confirmation', async () => {
    capabilities = ['device.read', 'device.actions'];
    render(<CustomerControlsWidget />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Reboot']);
    for (const admin of ['Edit', 'Blink', 'Update Supervisor', 'Enable SSH', 'Send']) {
      expect(screen.queryByText(admin)).toBeNull();
    }
    fireEvent.click(buttons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(customerApi).toHaveBeenCalledWith('/devices/abc/reboot', { method: 'POST' }));
  });

  it('disables Reboot while the device is offline', () => {
    capabilities = ['device.actions'];
    online = false;
    render(<CustomerControlsWidget />);
    expect((screen.getByRole('button', { name: 'Reboot' }) as HTMLButtonElement).disabled).toBe(true);
  });

  const rawCalls = () => (fetchMock.mock.calls as any[]).map((c) => [c[0], c[1]]);

  it('shows each new button only with its capability', () => {
    const cases: [string, string[]][] = [
      ['device.ssh', ['Enable SSH', 'Disable SSH']],
      ['device.loglevel', ['Set to info', 'Set to debug']],
      ['device.files', ['Upload Files', 'Download Files']],
      ['device.logs.download', ['Download']],
    ];
    for (const [cap, labels] of cases) {
      capabilities = ['device.read', cap];
      const { unmount } = render(<CustomerControlsWidget />);
      expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(labels);
      unmount();
    }
  });

  it('posts SSH state and log level to the customer routes', async () => {
    capabilities = ['device.ssh', 'device.loglevel'];
    render(<CustomerControlsWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable SSH' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('SSH enabled successfully', { type: 'success' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set to debug' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Log level changed to debug successfully', { type: 'success' }));
    const calls = rawCalls();
    expect(calls[0][0]).toBe('/api/customer/devices/abc/ssh');
    expect(JSON.parse(calls[0][1].body)).toEqual({ state: 'on' });
    expect(calls[1][0]).toBe('/api/customer/devices/abc/log-level');
    expect(JSON.parse(calls[1][1].body)).toEqual({ logLevels: 'debug' });
  });

  it('shows server error messages in either shape', async () => {
    capabilities = ['device.ssh'];
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'nope' }), { status: 403 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'job failed' }), { status: 500 }));
    render(<CustomerControlsWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable SSH' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Failed to enable SSH: nope', { type: 'error' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable SSH' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Failed to disable SSH: job failed', { type: 'error' }));
  });

  it('uploads files as multipart and downloads archives', async () => {
    capabilities = ['device.files', 'device.logs.download'];
    render(<CustomerControlsWidget />);
    const input: any = { click: vi.fn(), type: '', multiple: false };
    const anchor: any = { click: vi.fn(), remove: vi.fn() };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'input' ? input : tag === 'a' ? anchor : realCreate(tag)) as any);
    vi.spyOn(document.body, 'appendChild').mockImplementation(((n: any) => n) as any);
    (window.URL as any).createObjectURL = vi.fn(() => 'blob:x');
    (window.URL as any).revokeObjectURL = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Upload Files' }));
    expect(input.click).toHaveBeenCalled();
    await input.onchange({ target: { files: [new File(['x'], 'a.txt')] } });
    let [url, init] = rawCalls()[0];
    expect(url).toBe('/api/customer/devices/abc/files');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).getAll('files')).toHaveLength(1);
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(notify).toHaveBeenCalledWith('Files uploaded successfully', { type: 'success' });

    fireEvent.click(screen.getByRole('button', { name: 'Download Files' }));
    await waitFor(() => expect(anchor.click).toHaveBeenCalledTimes(1));
    expect(rawCalls()[1][0]).toBe('/api/customer/devices/abc/files/download');
    expect(anchor.download).toBe('outbound_gw.zip');

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(anchor.click).toHaveBeenCalledTimes(2));
    expect(rawCalls()[2][0]).toBe('/api/customer/devices/abc/logs/download');
    expect(anchor.download).toBe('logs_gw.tar.gz');
    vi.restoreAllMocks();
  });

  it('reports download failures with the server message and saves nothing', async () => {
    capabilities = ['device.files', 'device.logs.download'];
    const create = vi.fn(() => 'blob:x');
    (window.URL as any).createObjectURL = create;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'forbidden' }), { status: 403 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'job failed' }), { status: 500 }));
    render(<CustomerControlsWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Download Files' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Failed to download Files: forbidden', { type: 'error' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Failed to download logs: job failed', { type: 'error' }));
    expect(create).not.toHaveBeenCalled();
    for (const [, init] of rawCalls()) {
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toMatch(/^Bearer /);
    }
  });

  it('reports a failed upload with the server message', async () => {
    capabilities = ['device.files'];
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'too big' }), { status: 400 }));
    render(<CustomerControlsWidget />);
    const input: any = { click: vi.fn() };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((t: string) => (t === 'input' ? input : realCreate(t))) as any);
    fireEvent.click(screen.getByRole('button', { name: 'Upload Files' }));
    await input.onchange({ target: { files: [new File(['x'], 'a.txt')] } });
    expect(notify).toHaveBeenCalledWith('Failed to upload files: too big', { type: 'error' });
    vi.restoreAllMocks();
  });
});
