import { describe, it, expect, vi } from 'vitest';
import { routeByResource } from '../routeByResource';

const dp = (tag: string) =>
  Object.fromEntries(
    ['getList', 'getOne', 'getMany', 'getManyReference', 'create', 'update', 'updateMany', 'delete', 'deleteMany'].map((m) => [
      m,
      vi.fn(async () => tag),
    ]),
  ) as any;

describe('routeByResource', () => {
  it('routes listed resources and falls back otherwise', async () => {
    const routed = routeByResource(dp('postgrest'), { 'customer-devices': dp('customer') });
    expect(await routed.getList('customer-devices', {} as any)).toBe('customer');
    expect(await routed.getList('device', {} as any)).toBe('postgrest');
    expect(await routed.update('customer-devices', {} as any)).toBe('customer');
  });
});
