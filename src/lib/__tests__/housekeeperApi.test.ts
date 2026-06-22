import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import axios from 'axios';

vi.mock('axios');
vi.mock('react-admin', () => ({
  useAuthProvider: () => ({ getSession: () => ({ jwt: 'jwt-123' }) }),
}));
vi.mock('../reactAppEnv', () => ({ default: { REACT_APP_OPEN_BALENA_UI_URL: 'http://ui' } }));

import { useHousekeeperApi } from '../housekeeperApi';

beforeEach(() => vi.clearAllMocks());

describe('useHousekeeperApi', () => {
  it('getStatus GETs with bearer jwt', async () => {
    (axios.get as any).mockResolvedValue({ data: { status: 'idle' } });
    const { result } = renderHook(() => useHousekeeperApi());
    const s = await result.current.getStatus();
    expect(s.status).toBe('idle');
    expect((axios.get as any).mock.calls[0][0]).toBe('http://ui/housekeeper/status');
    expect((axios.get as any).mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-123');
  });

  it('getFleets returns the fleets array', async () => {
    (axios.get as any).mockResolvedValue({ data: { fleets: [{ name: 'MASTER', id: 17 }] } });
    const { result } = renderHook(() => useHousekeeperApi());
    expect(await result.current.getFleets()).toEqual([{ name: 'MASTER', id: 17 }]);
  });

  it('putConfig PUTs the full config', async () => {
    (axios.put as any).mockResolvedValue({ data: { schedule: '0 4 * * *' } });
    const { result } = renderHook(() => useHousekeeperApi());
    await result.current.putConfig({ schedule: '0 4 * * *' });
    expect((axios.put as any).mock.calls[0][0]).toBe('http://ui/housekeeper/config');
    expect((axios.put as any).mock.calls[0][1].schedule).toBe('0 4 * * *');
  });

  it('triggerRun POSTs and returns run_id', async () => {
    (axios.post as any).mockResolvedValue({ data: { run_id: 'r1' } });
    const { result } = renderHook(() => useHousekeeperApi());
    expect((await result.current.triggerRun({ fleets: ['MASTER'], window_days: 7 })).run_id).toBe('r1');
  });
});
