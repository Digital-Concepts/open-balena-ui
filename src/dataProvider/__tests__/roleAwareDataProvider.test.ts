import { describe, it, expect, vi } from 'vitest';
import { customerAdminShapedProvider } from '../customerDataProvider';
import { roleAwareDataProvider } from '../roleAwareDataProvider';
import { DEVICE_SEARCH_KEY } from '../../lib/deviceFilters';
import type { Permissions } from '../../lib/me';

const customerPerms: Permissions = { status: 'ok', me: { userId: 1, permissionSet: { id: 1, name: 'c' }, capabilities: ['device.read'] } };
const adminPerms: Permissions = { status: 'ok', me: { userId: 1, permissionSet: { id: 1, name: 'a' }, capabilities: ['admin'] } };

const setup = (perms: () => Promise<Permissions>, body: any = { data: [], total: 0 }) => {
  const http = vi.fn(async (_url: string) => ({ json: body }));
  const admin: any = Object.fromEntries(
    ['getList', 'getOne', 'getMany', 'getManyReference', 'create', 'update', 'updateMany', 'delete', 'deleteMany'].map((m) => [m, vi.fn(async () => ({ data: 'admin' }))]),
  );
  return { http, admin, dp: roleAwareDataProvider(admin, customerAdminShapedProvider(http as any), perms) };
};

describe('roleAwareDataProvider', () => {
  it('routes customer device list with mapped filters', async () => {
    const { http, dp, admin } = setup(async () => customerPerms);
    await dp.getList('device', {
      pagination: { page: 1, perPage: 10 },
      sort: { field: 'device name', order: 'ASC' },
      filter: { [DEVICE_SEARCH_KEY]: ' gw ', 'belongs to-application': 7 },
    });
    expect(http.mock.calls[0][0]).toBe('/api/customer/devices?page=1&perPage=10&sort=device+name&order=ASC&q=gw&fleetId=7');
    expect(admin.getList).not.toHaveBeenCalled();
  });
  it('routes device getOne and fetches getMany in one ids call', async () => {
    const http = vi.fn(async (url: string) => ({ json: url.includes('?ids=') ? { data: [{ id: 1 }, { id: 3 }], total: 2 } : { id: 1 } }));
    const dp = roleAwareDataProvider({} as any, customerAdminShapedProvider(http as any), async () => customerPerms);
    expect((await dp.getOne('device', { id: 1 })).data).toEqual({ id: 1 });
    expect(http.mock.calls[0][0]).toBe('/api/customer/devices/1');
    expect((await dp.getMany('device', { ids: [1, 2, 3, 1] })).data).toEqual([{ id: 1 }, { id: 3 }]);
    expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls[1][0]).toBe('/api/customer/devices?ids=1,2,3&perPage=100');
  });
  it('maps fleets and looks up application, release, device type', async () => {
    const { http, dp } = setup(async () => customerPerms, { data: [{ id: 3, 'app name': 'F', slug: 's', 'should track latest release': true }], total: 1 });
    expect(await dp.getList('application', { pagination: { page: 1, perPage: 25 }, sort: { field: 'id', order: 'ASC' }, filter: {} })).toEqual({
      data: [{ id: 3, 'app name': 'F', slug: 's', 'should track latest release': true }],
      total: 1,
    });
    expect(http.mock.calls[0][0]).toBe('/api/customer/fleets');
    http.mockImplementation(async () => ({ json: { data: [{ id: 5 }] } }) as any);
    await dp.getMany('release', { ids: [5, 6] });
    await dp.getMany('device type', { ids: [1] });
    expect(http.mock.calls[1][0]).toBe('/api/customer/lookup/release?ids=5,6');
    expect(http.mock.calls[2][0]).toBe('/api/customer/lookup/device%20type?ids=1');
    http.mockImplementation(async () => ({ json: { data: [] } }) as any);
    await expect(dp.getOne('application', { id: 9 })).rejects.toMatchObject({ status: 404 });
  });
  it('rejects other resources and writes for customers without any fetch', async () => {
    const { http, dp, admin } = setup(async () => customerPerms);
    await expect(dp.getList('image install', {} as any)).rejects.toThrow('Not available');
    await expect(dp.delete('device', { id: 1 } as any)).rejects.toThrow('Not available');
    expect(http).not.toHaveBeenCalled();
    expect(admin.getList).not.toHaveBeenCalled();
  });
  it('rejects when permissions fail to load or no access', async () => {
    const { admin, dp } = setup(async () => {
      throw new Error('boom');
    });
    await expect(dp.getList('device', {} as any)).rejects.toThrow('boom');
    const na = setup(async () => ({ status: 'no-access' }));
    await expect(na.dp.getList('device', {} as any)).rejects.toThrow('Not available');
    expect(admin.getList).not.toHaveBeenCalled();
  });
  it('passes admin calls to the admin provider and awaits permissions first', async () => {
    let resolve!: (p: Permissions) => void;
    const { dp, admin, http } = setup(() => new Promise((r) => (resolve = r)));
    const call = dp.getList('image install', {} as any);
    await Promise.resolve();
    expect(admin.getList).not.toHaveBeenCalled();
    resolve(adminPerms);
    expect((await call).data).toBe('admin');
    expect(admin.getList).toHaveBeenCalledWith('image install', {});
    expect(http).not.toHaveBeenCalled();
  });
});
