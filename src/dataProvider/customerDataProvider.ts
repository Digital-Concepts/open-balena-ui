import type { DataProvider, fetchUtils } from 'react-admin';
import { DEVICE_SEARCH_KEY } from '../lib/deviceFilters';

type HttpClient = (url: string, options?: fetchUtils.Options) => Promise<{ json: any }>;

export const CUSTOMER_RESOURCES = ['device', 'application', 'release', 'device type'];
const LOOKUP_NAMES: Record<string, string> = { application: 'application', release: 'release', 'device type': 'device type' };

const DEVICE_IDS_PER_CALL = 100;

const notFound = () => Object.assign(new Error('Not found'), { status: 404 });
const notAvailable = async (): Promise<never> => {
  throw new Error('Not available');
};

// Role-aware customer provider: admin-shaped resources backed by /api/customer/*.
export function customerAdminShapedProvider(http: HttpClient): DataProvider {
  const lookup = async (resource: string, ids: unknown[]): Promise<any[]> => {
    if (!ids.length) return [];
    const { json } = await http(`/api/customer/lookup/${encodeURIComponent(LOOKUP_NAMES[resource])}?ids=${ids.map(String).join(',')}`);
    return json.data;
  };
  const getDevice = async (id: unknown) => (await http(`/api/customer/devices/${encodeURIComponent(String(id))}`)).json;
  return {
    getList: async (resource, params) => {
      if (resource === 'application') {
        const { json } = await http('/api/customer/fleets');
        return { data: json.data, total: json.total ?? json.data.length } as any;
      }
      if (resource !== 'device') return notAvailable();
      const qs = new URLSearchParams();
      qs.set('page', String(params.pagination?.page ?? 1));
      qs.set('perPage', String(params.pagination?.perPage ?? 25));
      if (params.sort?.field) qs.set('sort', params.sort.field);
      if (params.sort?.order) qs.set('order', params.sort.order);
      const filter = params.filter ?? {};
      const q = String(filter[DEVICE_SEARCH_KEY] ?? filter.q ?? '').trim();
      if (q) qs.set('q', q);
      const fleetId = filter['belongs to-application'] ?? filter.fleetId;
      if (fleetId !== undefined && fleetId !== null && fleetId !== '') qs.set('fleetId', String(fleetId));
      if (filter['api heartbeat state'] === 'online') qs.set('online', '1');
      const { json } = await http(`/api/customer/devices?${qs}`);
      return { data: json.data, total: json.total };
    },
    getOne: async (resource, { id }) => {
      if (resource === 'device') return { data: await getDevice(id) } as any;
      if (!(resource in LOOKUP_NAMES)) return notAvailable();
      const row = (await lookup(resource, [id])).find((r) => String(r.id) === String(id));
      if (!row) throw notFound();
      return { data: row } as any;
    },
    getMany: async (resource, { ids }) => {
      if (resource === 'device') {
        const unique = [...new Set(ids.map(String))];
        const chunks: string[][] = [];
        for (let i = 0; i < unique.length; i += DEVICE_IDS_PER_CALL) chunks.push(unique.slice(i, i + DEVICE_IDS_PER_CALL));
        const pages = await Promise.all(
          chunks.map(async (chunk) => (await http(`/api/customer/devices?ids=${chunk.join(',')}&perPage=${DEVICE_IDS_PER_CALL}`)).json.data),
        );
        return { data: pages.flat() } as any;
      }
      if (!(resource in LOOKUP_NAMES)) return notAvailable();
      return { data: await lookup(resource, ids) } as any;
    },
    getManyReference: notAvailable,
    create: notAvailable,
    update: notAvailable,
    updateMany: notAvailable,
    delete: notAvailable,
    deleteMany: notAvailable,
  } as DataProvider;
}
