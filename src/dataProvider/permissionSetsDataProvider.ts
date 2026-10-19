import type { DataProvider } from 'react-admin';
import type { fetchUtils } from 'react-admin';

type HttpClient = (url: string, options?: fetchUtils.Options) => Promise<{ json: any }>;

const BASE = '/api/admin/permission-sets';
const body = (data: Record<string, unknown>) =>
  JSON.stringify({ name: data.name, description: data.description, capabilities: data.capabilities });

export function permissionSetsDataProvider(http: HttpClient): DataProvider {
  const list = async () => (await http(BASE)).json as { data: any[]; total: number };
  return {
    getList: async () => list(),
    getOne: async (_r, { id }) => ({ data: (await http(`${BASE}/${id}`)).json }),
    getMany: async (_r, { ids }) => ({ data: (await list()).data.filter((s) => ids.includes(s.id)) }),
    getManyReference: async () => list(),
    create: async (_r, { data }) => ({ data: (await http(BASE, { method: 'POST', body: body(data) })).json }),
    update: async (_r, { id, data }) => ({ data: (await http(`${BASE}/${id}`, { method: 'PUT', body: body(data) })).json }),
    updateMany: async () => {
      throw new Error('Not supported');
    },
    delete: async (_r, { id, previousData }) => {
      await http(`${BASE}/${id}`, { method: 'DELETE' });
      return { data: previousData ?? ({ id } as any) };
    },
    deleteMany: async (_r, { ids }) => {
      for (const id of ids) await http(`${BASE}/${id}`, { method: 'DELETE' });
      return { data: ids };
    },
  } as DataProvider;
}
