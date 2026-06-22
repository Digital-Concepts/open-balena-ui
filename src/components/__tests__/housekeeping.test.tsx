/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = {
  getStatus: vi.fn(), getConfig: vi.fn(), putConfig: vi.fn(),
  getRuns: vi.fn().mockResolvedValue([]), getRunLog: vi.fn(),
  getAudit: vi.fn().mockResolvedValue([]), getFleets: vi.fn(), triggerRun: vi.fn(),
};
vi.mock('../../lib/housekeeperApi', () => ({ useHousekeeperApi: () => api }));
const notify = vi.fn();
vi.mock('react-admin', () => ({ useNotify: () => notify }));

import { HousekeepingPage } from '../housekeeping';

beforeEach(() => {
  vi.clearAllMocks();
  api.getStatus.mockResolvedValue({ status: 'idle', next_scheduled_at: '2026-06-23T03:00:00Z', last_run: null });
  api.getConfig.mockResolvedValue({
    schedule: '0 3 * * *',
    release_cleanup: { window_days: 30, exclude_fleets: ['gorgon'] },
    registry_gc: { retention_keep_per_fleet: 10, failed_grace_hours: 48 },
  });
  api.getFleets.mockResolvedValue([{ name: 'MASTER', id: 17 }, { name: 'gorgon', id: 2 }]);
});

describe('Ad-hoc single-fleet run', () => {
  it('ad-hoc run: confirm then triggerRun with fleet + window, notifies success via run_id gate', async () => {
    api.triggerRun.mockResolvedValue({ run_id: 'r9' });
    // initial load returns no last_run; after trigger, poll returns completed run with matching id
    api.getStatus
      .mockResolvedValueOnce({ status: 'idle', last_run: null })
      .mockResolvedValue({ status: 'idle', last_run: { id: 'r9', result: 'success' } });
    render(<HousekeepingPage />);
    fireEvent.mouseDown(await screen.findByLabelText(/fleet to clean/i));
    fireEvent.click(await screen.findByRole('option', { name: 'MASTER' }));
    fireEvent.change(await screen.findByLabelText(/custom window/i), { target: { value: '14' } });
    fireEvent.click(await screen.findByRole('button', { name: /^run$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(api.triggerRun).toHaveBeenCalledWith({ fleets: ['MASTER'], window_days: 14 }));
    // poll fires at 3s; wait up to 10s for the gated completion notify
    await waitFor(
      () => expect(notify).toHaveBeenCalledWith('Run success', { type: 'success' }),
      { timeout: 10000 },
    );
  });

  it('ad-hoc run 409 shows already-in-progress', async () => {
    api.triggerRun.mockRejectedValue({ response: { status: 409, data: { error: 'a housekeeping run is already in progress' } } });
    render(<HousekeepingPage />);
    fireEvent.mouseDown(await screen.findByLabelText(/fleet to clean/i));
    fireEvent.click(await screen.findByRole('option', { name: 'MASTER' }));
    fireEvent.click(await screen.findByRole('button', { name: /^run$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/in progress/i), { type: 'warning' }));
  });
});

describe('HousekeepingPage status + config', () => {
  it('shows status idle and next scheduled', async () => {
    render(<HousekeepingPage />);
    expect(await screen.findByText(/idle/i)).toBeInTheDocument();
  });

  it('loads config values and fleet checkboxes (gorgon excluded)', async () => {
    render(<HousekeepingPage />);
    expect(await screen.findByDisplayValue('0 3 * * *')).toBeInTheDocument();
    expect(await screen.findByLabelText('Window (days)')).toHaveValue(30);
    // gorgon checkbox checked (excluded), MASTER unchecked
    const gorgon = await screen.findByLabelText('gorgon');
    const master = await screen.findByLabelText('MASTER');
    expect(gorgon).toBeChecked();
    expect(master).not.toBeChecked();
  });

  it('save calls putConfig with the full config', async () => {
    api.putConfig.mockResolvedValue({});
    render(<HousekeepingPage />);
    fireEvent.change(await screen.findByLabelText('Window (days)'), { target: { value: '14' } });
    fireEvent.click(await screen.findByRole('button', { name: /save config/i }));
    await waitFor(() => expect(api.putConfig).toHaveBeenCalled());
    const sent = api.putConfig.mock.calls[0][0];
    expect(sent.release_cleanup.window_days).toBe(14);
    expect(sent.schedule).toBe('0 3 * * *');
    expect(sent.release_cleanup.exclude_fleets).toEqual(['gorgon']);
    expect(sent.registry_gc.retention_keep_per_fleet).toBe(10);
  });
});
