import { describe, it, expect, vi } from 'vitest';
import { auditDataProvider } from '../auditDataProvider';

describe('auditDataProvider', () => {
  it('lists with paging and filters', async () => {
    const http = vi.fn(async (_url: string) => ({ json: { data: [{ id: 1 }], total: 1 } }));
    const dp = auditDataProvider(http as any);
    const res = await dp.getList('audit', {
      pagination: { page: 2, perPage: 50 },
      sort: { field: 'ts', order: 'DESC' },
      filter: { userId: 3, action: 'tag.create', fleetId: 7, other: 'x' },
    });
    expect(res).toEqual({ data: [{ id: 1 }], total: 1 });
    const url = new URL(http.mock.calls[0][0], 'http://x');
    expect(url.pathname).toBe('/api/admin/audit');
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', perPage: '50', userId: '3', action: 'tag.create', fleetId: '7' });
  });

  it('omits empty filters', async () => {
    const http = vi.fn(async (_url: string) => ({ json: { data: [], total: 0 } }));
    await auditDataProvider(http as any).getList('audit', { pagination: { page: 1, perPage: 25 }, sort: { field: 'ts', order: 'DESC' }, filter: { userId: '' } });
    expect(http.mock.calls[0][0]).toBe('/api/admin/audit?page=1&perPage=25');
  });

  it('reads large ranges (CSV export) in server-sized pages', async () => {
    const total = 450;
    const http = vi.fn(async (url: string) => {
      const q = new URL(url, 'http://x').searchParams;
      const page = Number(q.get('page'));
      const perPage = Number(q.get('perPage'));
      const ids = Array.from({ length: total }, (_, i) => i + 1).slice((page - 1) * perPage, page * perPage);
      return { json: { data: ids.map((id) => ({ id })), total } };
    });
    const res = await auditDataProvider(http as any).getList('audit', {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'ts', order: 'DESC' },
      filter: { fleetId: 7 },
    });
    expect(res.total).toBe(450);
    expect(res.data.map((r: any) => r.id)).toEqual(Array.from({ length: 450 }, (_, i) => i + 1));
    expect(http).toHaveBeenCalledTimes(3);
    for (const [url] of http.mock.calls) {
      const q = new URL(url, 'http://x').searchParams;
      expect(Number(q.get('perPage'))).toBeLessThanOrEqual(200);
      expect(q.get('fleetId')).toBe('7');
    }
  });

  it('rejects everything else', async () => {
    const dp = auditDataProvider(vi.fn() as any);
    await expect(dp.getOne('audit', { id: 1 })).rejects.toThrow();
    await expect(dp.delete('audit', { id: 1 })).rejects.toThrow();
  });
});
