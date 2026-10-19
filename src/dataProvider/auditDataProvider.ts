import type { DataProvider } from 'react-admin';
import type { fetchUtils } from 'react-admin';

type HttpClient = (url: string, options?: fetchUtils.Options) => Promise<{ json: any }>;

const BASE = '/api/admin/audit';
const MAX_PER_PAGE = 200;
const FILTER_KEYS = ['userId', 'action', 'fleetId'] as const;

const unsupported = async () => {
  throw new Error('Not supported');
};

export function auditDataProvider(http: HttpClient): DataProvider {
  return {
    getList: async (_resource, { pagination = { page: 1, perPage: 25 }, filter }) => {
      const extra = new URLSearchParams();
      for (const key of FILTER_KEYS) {
        const value = filter?.[key];
        if (value !== undefined && value !== null && value !== '') extra.set(key, String(value));
      }
      const fetchPage = async (page: number, perPage: number) => {
        const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
        extra.forEach((v, k) => params.set(k, v));
        return (await http(`${BASE}?${params}`)).json as { data: any[]; total: number };
      };
      if (pagination.perPage <= MAX_PER_PAGE) return fetchPage(pagination.page, pagination.perPage);

      // Larger ranges (CSV export) are read in server-sized pages.
      const start = (pagination.page - 1) * pagination.perPage;
      const end = start + pagination.perPage;
      const data: any[] = [];
      let total = Infinity;
      for (let pos = start; pos < end && pos < total; ) {
        const page = Math.floor(pos / MAX_PER_PAGE) + 1;
        const res = await fetchPage(page, MAX_PER_PAGE);
        total = res.total;
        const rows = res.data.slice(pos % MAX_PER_PAGE);
        if (rows.length === 0) break;
        data.push(...rows.slice(0, end - pos));
        pos += Math.min(rows.length, end - pos);
      }
      return { data, total: Number.isFinite(total) ? total : data.length };
    },
    getOne: unsupported,
    getMany: unsupported,
    getManyReference: unsupported,
    create: unsupported,
    update: unsupported,
    updateMany: unsupported,
    delete: unsupported,
    deleteMany: unsupported,
  } as DataProvider;
}
