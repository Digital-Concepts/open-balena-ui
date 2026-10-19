// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openStore, setStore } from '../../permissions/store';
import { fleetIdsFor, clearScopeCache, scopeFilter, inScope, loadDeviceInScope } from '../scope';

const routes: Record<string, unknown> = {};
let linked: ReturnType<typeof openStore>;
beforeEach(() => {
  process.env.OPEN_BALENA_API_URL = 'https://api.example';
  process.env.OPEN_BALENA_SERVICE_API_KEY = 'svc';
  clearScopeCache();
  const store = openStore(':memory:');
  store.setOrgSettings(1, { permissionSetId: store.createSet({ name: 'C', capabilities: ['device.read'] }).id });
  setStore(store);
  linked = store;
  for (const k of Object.keys(routes)) delete routes[k];
  global.fetch = vi.fn(async (url: string) => {
    const path = decodeURIComponent(String(url).replace('https://api.example/v7/', ''));
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    return { ok: true, status: 200, json: async () => ({ d: key ? routes[key] : [] }) };
  }) as any;
});

const req = (userId: number, caps: string[], uuid?: string) =>
  ({ user: { id: userId }, capabilities: caps, params: { uuid } }) as any;

describe('scope', () => {
  it('fleets of all member orgs', async () => {
    routes['organization_membership'] = [{ is_member_of__organization: { __id: 1 } }, { is_member_of__organization: { __id: 2 } }];
    routes['application'] = [{ id: 10 }, { id: 11 }];
    expect(await fleetIdsFor(5)).toEqual([10, 11]);
    const appCall = (global.fetch as any).mock.calls.map((c: any[]) => decodeURIComponent(c[0])).find((u: string) => u.includes('/application'));
    expect(appCall).toContain('organization eq 1 or organization eq 2');
  });
  it('customer scope is the linked org only, ignoring stray memberships', async () => {
    linked.setUserCustomer(5, 1);
    routes['organization_membership'] = [{ is_member_of__organization: { __id: 2 } }];
    routes['application'] = [{ id: 10 }];
    expect(await fleetIdsFor(5)).toEqual([10]);
    const urls = (global.fetch as any).mock.calls.map((c: any[]) => decodeURIComponent(c[0]));
    expect(urls.some((u: string) => u.includes('organization_membership'))).toBe(false);
    expect(urls.find((u: string) => u.includes('/application'))).toContain('organization eq 1');
    expect(urls.find((u: string) => u.includes('/application'))).not.toContain('organization eq 2');
  });
  it('no memberships → no fleets, filter matches nothing', async () => {
    expect(await fleetIdsFor(5)).toEqual([]);
    expect(scopeFilter({ all: false, fleetIds: [] }, 'belongs_to__application')).toBe('belongs_to__application eq -1');
  });
  it('admin scope is unrestricted', () => {
    expect(scopeFilter({ all: true }, 'id')).toBeNull();
    expect(inScope({ all: true }, 99)).toBe(true);
  });
  it('rejects malformed uuids without calling the API', async () => {
    await expect(loadDeviceInScope(req(5, ['device.read'], "abc' or 1 eq 1"))).rejects.toMatchObject({ status: 403 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('403 for a device in a foreign fleet, device for own fleet', async () => {
    const uuid = 'a'.repeat(32);
    routes['organization_membership'] = [{ is_member_of__organization: { __id: 1 } }];
    routes['application'] = [{ id: 10 }];
    routes['device'] = [{ id: 3, uuid, belongs_to__application: [{ id: 99, app_name: 'X' }] }];
    await expect(loadDeviceInScope(req(5, ['device.read'], uuid))).rejects.toMatchObject({ status: 403 });
    clearScopeCache();
    routes['device'] = [{ id: 3, uuid, belongs_to__application: [{ id: 10, app_name: 'Mine' }] }];
    expect((await loadDeviceInScope(req(5, ['device.read'], uuid))).id).toBe(3);
  });
});
