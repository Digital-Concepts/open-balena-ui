import type { DataProvider } from 'react-admin';

const METHODS = ['getList', 'getOne', 'getMany', 'getManyReference', 'create', 'update', 'updateMany', 'delete', 'deleteMany'] as const;

// Sends the listed resources to their own provider and everything else to the fallback.
export function routeByResource(fallback: DataProvider, routes: Record<string, DataProvider>): DataProvider {
  const routed: Record<string, unknown> = { ...fallback };
  for (const method of METHODS) {
    routed[method] = (resource: string, params: unknown) =>
      ((routes[resource] ?? fallback)[method] as (r: string, p: unknown) => Promise<unknown>)(resource, params);
  }
  return routed as unknown as DataProvider;
}
