import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import axios from 'axios';

vi.mock('axios');
vi.mock('react-admin', () => ({
  useAuthProvider: () => ({ getSession: () => ({ jwt: 'jwt-123' }) }),
}));
vi.mock('../reactAppEnv', () => ({ default: { REACT_APP_OPEN_BALENA_UI_URL: 'http://ui' } }));

import { useSecurityApi } from '../securityApi';

beforeEach(() => vi.clearAllMocks());

describe('useSecurityApi', () => {
  it('getStatus GETs with bearer jwt', async () => {
    (axios.get as any).mockResolvedValue({ data: { status: 'idle' } });
    const { result } = renderHook(() => useSecurityApi());
    const s = await result.current.getStatus();
    expect(s.status).toBe('idle');
    expect((axios.get as any).mock.calls[0][0]).toBe('http://ui/security/status');
    expect((axios.get as any).mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-123');
  });

  it('getLatest GETs /runs/latest', async () => {
    (axios.get as any).mockResolvedValue({ data: { id: 'r1' } });
    const { result } = renderHook(() => useSecurityApi());
    expect((await result.current.getLatest()).id).toBe('r1');
    expect((axios.get as any).mock.calls[0][0]).toBe('http://ui/security/runs/latest');
  });

  it('getRunDetail encodes the id', async () => {
    (axios.get as any).mockResolvedValue({ data: { id: 'r/1' } });
    const { result } = renderHook(() => useSecurityApi());
    await result.current.getRunDetail('r/1');
    expect((axios.get as any).mock.calls[0][0]).toBe('http://ui/security/runs/r%2F1');
  });

  it('putConfig PUTs the config', async () => {
    (axios.put as any).mockResolvedValue({ data: { schedule: '0 4 * * *' } });
    const { result } = renderHook(() => useSecurityApi());
    await result.current.putConfig({ schedule: '0 4 * * *', history_cap: 10 });
    expect((axios.put as any).mock.calls[0][0]).toBe('http://ui/security/config');
    expect((axios.put as any).mock.calls[0][1].history_cap).toBe(10);
  });

  it('triggerRun POSTs and returns run_id', async () => {
    (axios.post as any).mockResolvedValue({ data: { run_id: 'r1' } });
    const { result } = renderHook(() => useSecurityApi());
    expect((await result.current.triggerRun()).run_id).toBe('r1');
    expect((axios.post as any).mock.calls[0][0]).toBe('http://ui/security/run');
  });

  it('downloadSbom requests the blob for run+image', async () => {
    (axios.get as any).mockResolvedValue({ data: new Blob(['{}']) });
    const { result } = renderHook(() => useSecurityApi());
    await result.current.downloadSbom('r1', 'redis_7');
    expect((axios.get as any).mock.calls[0][0]).toBe('http://ui/security/runs/r1/sbom/redis_7');
    expect((axios.get as any).mock.calls[0][1].responseType).toBe('blob');
  });

  it('getFleets GETs /fleets', async () => {
    (axios.get as any).mockResolvedValue({ data: [{ fleet: 'release_OPUS_Pi3' }] });
    const { result } = renderHook(() => useSecurityApi());
    expect((await result.current.getFleets())[0].fleet).toBe('release_OPUS_Pi3');
    expect((axios.get as any).mock.calls[0][0]).toBe('http://ui/security/fleets');
  });

  it('getFleetRelease encodes fleet and release', async () => {
    (axios.get as any).mockResolvedValue({ data: { release: '2.0.004' } });
    const { result } = renderHook(() => useSecurityApi());
    await result.current.getFleetRelease('release_OPUS_Pi3', '2.0.004');
    expect((axios.get as any).mock.calls[0][0])
      .toBe('http://ui/security/fleets/release_OPUS_Pi3/releases/2.0.004');
  });

  it('downloadFleetSbom requests the blob for fleet+release+service', async () => {
    (axios.get as any).mockResolvedValue({ data: new Blob(['{}']) });
    const { result } = renderHook(() => useSecurityApi());
    await result.current.downloadFleetSbom('release_OPUS_Pi3', '2.0.004', 'Valkey');
    expect((axios.get as any).mock.calls[0][0])
      .toBe('http://ui/security/fleets/release_OPUS_Pi3/releases/2.0.004/sbom/Valkey');
    expect((axios.get as any).mock.calls[0][1].responseType).toBe('blob');
  });
});
