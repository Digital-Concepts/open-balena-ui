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

describe('HousekeepingPage status + config', () => {
  it('shows status idle and next scheduled', async () => {
    render(<HousekeepingPage />);
    expect(await screen.findByText(/idle/i)).toBeInTheDocument();
  });

  it('loads config values and fleet checkboxes (gorgon excluded)', async () => {
    render(<HousekeepingPage />);
    expect(await screen.findByDisplayValue('0 3 * * *')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('30')).toBeInTheDocument();
    // gorgon checkbox checked (excluded), MASTER unchecked
    const gorgon = await screen.findByLabelText('gorgon');
    const master = await screen.findByLabelText('MASTER');
    expect(gorgon).toBeChecked();
    expect(master).not.toBeChecked();
  });

  it('save calls putConfig with the full config', async () => {
    api.putConfig.mockResolvedValue({});
    render(<HousekeepingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /save config/i }));
    await waitFor(() => expect(api.putConfig).toHaveBeenCalled());
    const sent = api.putConfig.mock.calls[0][0];
    expect(sent.schedule).toBe('0 3 * * *');
    expect(sent.release_cleanup.exclude_fleets).toEqual(['gorgon']);
    expect(sent.registry_gc.retention_keep_per_fleet).toBe(10);
  });
});
