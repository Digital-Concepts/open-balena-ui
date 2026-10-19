import { describe, it, expect, vi } from 'vitest';
import { permissionSetsDataProvider } from '../permissionSetsDataProvider';

describe('permissionSetsDataProvider', () => {
  it('maps react-admin calls to the admin API', async () => {
    const http = vi.fn(async (url: string, _init?: any) => ({
      json: url.endsWith('/permission-sets') ? { data: [{ id: 1, name: 'Admin' }, { id: 2, name: 'C' }], total: 2 } : { id: 2, name: 'C' },
    }));
    const dp = permissionSetsDataProvider(http as any);
    expect(await dp.getList('permission-sets', { pagination: { page: 1, perPage: 25 }, sort: { field: 'id', order: 'ASC' }, filter: {} })).toEqual({
      data: [{ id: 1, name: 'Admin' }, { id: 2, name: 'C' }],
      total: 2,
    });
    expect((await dp.getMany('permission-sets', { ids: [2] })).data).toEqual([{ id: 2, name: 'C' }]);
    await dp.update('permission-sets', { id: 2, data: { name: 'C2', capabilities: ['device.read'], builtin: false, id: 2 }, previousData: { id: 2 } });
    const [url, init] = http.mock.calls[http.mock.calls.length - 1];
    expect(url).toBe('/api/admin/permission-sets/2');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ name: 'C2', capabilities: ['device.read'] });
  });
});
