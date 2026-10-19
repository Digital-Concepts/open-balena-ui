import type { DataProvider } from 'react-admin';
import { CUSTOMER_RESOURCES } from './customerDataProvider';
import { isAdmin, type Permissions } from '../lib/me';

const METHODS = ['getList', 'getOne', 'getMany', 'getManyReference', 'create', 'update', 'updateMany', 'delete', 'deleteMany'] as const;

// Awaits the (cached) permissions before every call: admins use the admin provider,
// customers only reach the customer provider, everything else rejects.
export function roleAwareDataProvider(
  admin: DataProvider,
  customer: DataProvider,
  loadPerms: () => Promise<Permissions>,
  customerResources: string[] = CUSTOMER_RESOURCES,
): DataProvider {
  const wrapped: Record<string, unknown> = {};
  for (const method of METHODS) {
    wrapped[method] = async (resource: string, params: unknown) => {
      const perms = await loadPerms();
      if (isAdmin(perms)) return (admin[method] as (r: string, p: unknown) => Promise<unknown>)(resource, params);
      if (perms.status === 'ok' && customerResources.includes(resource)) {
        return (customer[method] as (r: string, p: unknown) => Promise<unknown>)(resource, params);
      }
      throw new Error('Not available');
    };
  }
  return wrapped as unknown as DataProvider;
}
