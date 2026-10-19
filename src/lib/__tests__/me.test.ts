import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadPermissions, clearPermissionsCache, can, isAdmin } from '../me';

beforeEach(() => clearPermissionsCache());

describe('me', () => {
  it('loads and caches per token', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ userId: 5, permissionSet: { id: 2, name: 'C' }, capabilities: ['device.read'] }) })) as any;
    const p = await loadPermissions('t');
    await loadPermissions('t');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(can(p, 'device.read')).toBe(true);
    expect(can(p, 'device.logs')).toBe(false);
    expect(isAdmin(p)).toBe(false);
  });
  it('concurrent loads for one token make one fetch', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ userId: 5, permissionSet: { id: 2, name: 'C' }, capabilities: [] }) })) as any;
    await Promise.all([loadPermissions('t'), loadPermissions('t')]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it('403 means no access', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, statusText: 'Forbidden' })) as any;
    expect(await loadPermissions('t')).toEqual({ status: 'no-access' });
  });
  it('other errors reject with status', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized' })) as any;
    await expect(loadPermissions('t')).rejects.toMatchObject({ status: 401 });
  });
  it('admin can everything', () => {
    const p = { status: 'ok' as const, me: { userId: 1, permissionSet: { id: 1, name: 'Admin' }, capabilities: ['admin'] } };
    expect(isAdmin(p)).toBe(true);
    expect(can(p, 'device.logs')).toBe(true);
  });
});
