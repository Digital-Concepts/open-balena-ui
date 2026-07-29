/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = {
  getStatus: vi.fn(), getLatest: vi.fn(), getRuns: vi.fn().mockResolvedValue([]),
  getRunDetail: vi.fn(), getRunLog: vi.fn(), getAudit: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn(), putConfig: vi.fn(), triggerRun: vi.fn(), downloadSbom: vi.fn(),
};
vi.mock('../../lib/securityApi', () => ({ useSecurityApi: () => api }));
const notify = vi.fn();
vi.mock('react-admin', () => ({ useNotify: () => notify }));

import { SecurityPage } from '../security';

const LATEST = {
  id: '20260722-030000',
  started_at: '2026-07-22T03:00:00Z',
  totals: { critical: 0, high: 4, medium: 8, low: 2, unknown: 0 },
  images: [
    { image: 'alpine:3.9', totals: { critical: 0, high: 4, medium: 8, low: 2, unknown: 0 },
      sbom_file: 'alpine_3.9.sbom.cdx.json' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getStatus.mockResolvedValue({ status: 'idle', next_scheduled_at: '2026-07-23T03:00:00Z', last_run: null });
  api.getLatest.mockResolvedValue(LATEST);
  api.getConfig.mockResolvedValue({ schedule: '0 3 * * *', history_cap: 30 });
  api.getRuns.mockResolvedValue([]);
  api.getAudit.mockResolvedValue([]);
});

describe('status + severity summary', () => {
  it('shows status idle', async () => {
    render(<SecurityPage />);
    expect(await screen.findByText(/idle/i)).toBeInTheDocument();
  });

  it('renders latest severity totals', async () => {
    render(<SecurityPage />);
    // the high count (4) from the latest run
    expect(await screen.findByTestId('sev-high')).toHaveTextContent('4');
    expect(await screen.findByTestId('sev-medium')).toHaveTextContent('8');
  });

  it('renders per-image row with counts', async () => {
    render(<SecurityPage />);
    expect(await screen.findByText('alpine:3.9')).toBeInTheDocument();
  });

  it('sorts the per-image list alphabetically', async () => {
    api.getLatest.mockResolvedValue({
      id: 'r1',
      totals: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      images: [
        { image: 'zeta:1', totals: {}, sbom_file: 'zeta_1.sbom.cdx.json' },
        { image: 'alpha:2', totals: {}, sbom_file: 'alpha_2.sbom.cdx.json' },
        { image: 'mid:3', totals: {}, sbom_file: 'mid_3.sbom.cdx.json' },
      ],
    });
    render(<SecurityPage />);
    await screen.findByText('alpha:2');
    const cells = screen.getAllByTestId('image-cell').map((c) => c.textContent);
    expect(cells).toEqual(['alpha:2', 'mid:3', 'zeta:1']);
  });

  it('SBOM download button calls downloadSbom with run id + image name', async () => {
    api.downloadSbom.mockResolvedValue(new Blob(['{}']));
    render(<SecurityPage />);
    fireEvent.click(await screen.findByRole('button', { name: /sbom/i }));
    await waitFor(() =>
      expect(api.downloadSbom).toHaveBeenCalledWith('20260722-030000', 'alpine_3.9'));
  });
});

describe('run now', () => {
  it('confirm then triggerRun, success notify via run_id gate', async () => {
    api.triggerRun.mockResolvedValue({ run_id: 'r9' });
    api.getStatus
      .mockResolvedValueOnce({ status: 'idle', last_run: null })
      .mockResolvedValue({ status: 'idle', last_run: { id: 'r9', result: 'success' } });
    render(<SecurityPage />);
    fireEvent.click(await screen.findByRole('button', { name: /run scan/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(api.triggerRun).toHaveBeenCalled());
    await waitFor(
      () => expect(notify).toHaveBeenCalledWith('Scan success', { type: 'success' }),
      { timeout: 10000 },
    );
  });

  it('409 shows already-in-progress', async () => {
    api.triggerRun.mockRejectedValue({ response: { status: 409, data: { error: 'a security scan is already in progress' } } });
    render(<SecurityPage />);
    fireEvent.click(await screen.findByRole('button', { name: /run scan/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/in progress/i), { type: 'warning' }));
  });
});

describe('run history + log', () => {
  it('renders run history rows', async () => {
    api.getRuns.mockResolvedValue([{ id: 'r1', started_at: 'x', ended_at: 'y', result: 'success',
      totals: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 } }]);
    render(<SecurityPage />);
    expect(await screen.findByText('r1')).toBeInTheDocument();
  });

  it('row click loads + shows the run log', async () => {
    api.getRuns.mockResolvedValue([{ id: 'r1', started_at: 'x', ended_at: 'y', result: 'success', totals: {} }]);
    api.getRunLog.mockResolvedValue('LOG LINE A\nLOG LINE B');
    render(<SecurityPage />);
    fireEvent.click(await screen.findByText('r1'));
    expect(await screen.findByText(/LOG LINE A/)).toBeInTheDocument();
    expect(api.getRunLog).toHaveBeenCalledWith('r1');
  });

  it('row click log error notifies', async () => {
    api.getRuns.mockResolvedValue([{ id: 'r1', started_at: 'x', ended_at: 'y', result: 'success', totals: {} }]);
    api.getRunLog.mockRejectedValue(new Error('boom'));
    render(<SecurityPage />);
    fireEvent.click(await screen.findByText('r1'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Failed to load run log', { type: 'error' }));
  });
});

describe('config + audit', () => {
  it('loads config values', async () => {
    render(<SecurityPage />);
    expect(await screen.findByDisplayValue('0 3 * * *')).toBeInTheDocument();
    expect(await screen.findByLabelText(/history/i)).toHaveValue(30);
  });

  it('save calls putConfig with edited values', async () => {
    api.putConfig.mockResolvedValue({});
    render(<SecurityPage />);
    fireEvent.change(await screen.findByLabelText(/history/i), { target: { value: '10' } });
    fireEvent.click(await screen.findByRole('button', { name: /save config/i }));
    await waitFor(() => expect(api.putConfig).toHaveBeenCalled());
    const sent = api.putConfig.mock.calls[0][0];
    expect(sent.history_cap).toBe(10);
    expect(sent.schedule).toBe('0 3 * * *');
  });

  it('renders audit rows', async () => {
    api.getAudit.mockResolvedValue([{ ts: '2026-07-22T03:00:00Z', type: 'run-finished', result: 'success' }]);
    render(<SecurityPage />);
    expect(await screen.findByText('run-finished')).toBeInTheDocument();
  });
});
