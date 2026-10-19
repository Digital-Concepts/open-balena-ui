import express from 'express';
import { vi } from 'vitest';
import { SignJWT } from 'jose';
import { openStore, setStore } from '../../permissions/store';
import { clearScopeCache } from '../scope';
import customerRoutes from '../routes';

export const SECRET = 'test-secret';
export const OWN_UUID = 'a'.repeat(32);
export const FOREIGN_UUID = 'b'.repeat(32);

export type Call = { method: string; path: string; body: any; headers?: Record<string, string> };

export const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/', customerRoutes);

// Fake balena API: user 5 is in org 1, which owns fleet 10. Device a… is in fleet 10, b… in fleet 99.
export function setup(
  caps: string[],
  opts: { memberships?: unknown[]; publicKeys?: unknown[] } = {},
): { calls: Call[]; token: () => Promise<string> } {
  process.env.OPEN_BALENA_JWT_SECRET = SECRET;
  process.env.OPEN_BALENA_API_URL = 'https://api.example';
  process.env.OPEN_BALENA_SERVICE_API_KEY = 'svc';
  clearScopeCache();
  const store = openStore(':memory:');
  store.assignUser(5, store.createSet({ name: 'T', capabilities: caps }).id);
  setStore(store);
  const calls: Call[] = [];
  const device = (uuid: string, fleet: number, id: number) => ({
    id,
    uuid,
    device_name: `dev-${id}`,
    belongs_to__application: { __id: fleet },
    is_of__device_type: { __id: 7 },
    api_heartbeat_state: 'online',
    is_online: true,
    is_connected_to_vpn: true,
    last_vpn_event: '2026-10-01T00:00:00Z',
    last_connectivity_event: '2026-10-01T00:00:00Z',
    ip_address: '10.0.0.1',
    mac_address: 'AA:BB',
    note: 'n',
    status: 'Idle',
    os_version: 'balenaOS 6',
    os_variant: 'prod',
    supervisor_version: '16.0.0',
    is_running__release: { __id: 50 },
    is_pinned_on__release: null,
    cpu_usage: 5,
    cpu_temp: 40,
    memory_usage: 100,
    memory_total: 1000,
    storage_usage: 200,
    storage_total: 2000,
    created_at: '2026-09-01T00:00:00Z',
  });
  const fleetRec = (id: number) => ({ id, app_name: `fleet-${id}`, slug: `org/fleet-${id}`, organization: { __id: 1 }, should_be_running__release: { __id: 60 }, should_track_latest_release: true });
  const releaseRec = (id: number, fleet: number) => ({
    id,
    commit: 'c0ffee00',
    semver_major: 2,
    semver_minor: 0,
    semver_patch: 0,
    semver_prerelease: '',
    semver_build: '',
    revision: 0,
    raw_version: '2.0.0',
    status: 'success',
    created_at: '2026-10-01',
    is_final: true,
    belongs_to__application: { __id: fleet },
  });
  global.fetch = vi.fn(async (url: string, init: any = {}) => {
    const path = decodeURIComponent(String(url).replace('https://api.example', ''));
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body, headers: init.headers });
    const json = (d: unknown) => ({ ok: true, status: 200, json: async () => ({ d }), text: async () => 'OK' });
    if (path.startsWith('/v7/organization_membership'))
      return json(opts.memberships ?? [{ is_member_of__organization: { __id: 1 } }]);
    // Lookup queries ignore their filter here so the route's own scope check is what the tests exercise.
    if (path.startsWith('/v7/application?') && path.includes('slug')) return json([fleetRec(10), fleetRec(99)]);
    if (path.startsWith('/v7/device_type')) return json([{ id: 7, slug: 'rpi', name: 'Raspberry Pi', extra: 'x' }]);
    if (path.startsWith('/v7/release?') && path.includes('semver_major')) return json([releaseRec(60, 10), releaseRec(61, 99)]);
    if (path.startsWith('/v7/application')) return json(path.includes('organization eq') ? [{ id: 10 }] : [{ id: 10, app_name: 'fleet-10' }]);
    if (path.startsWith('/v7/device/$count')) return json(1);
    if (path.startsWith('/v7/device?') && path.includes(`uuid eq '${OWN_UUID}'`)) return json([device(OWN_UUID, 10, 3)]);
    if (path.startsWith('/v7/device?') && path.includes(`uuid eq '${FOREIGN_UUID}'`)) return json([device(FOREIGN_UUID, 99, 4)]);
    if (path.startsWith('/v7/device?') && path.includes('$filter=id eq 4')) return json([device(FOREIGN_UUID, 99, 4)]);
    if (path.startsWith('/v7/device?') && path.includes('$filter=id eq 3')) return json([device(OWN_UUID, 10, 3)]);
    if (path.startsWith('/v7/device?')) return json([device(OWN_UUID, 10, 3)]);
    if (path.startsWith('/v7/image_install'))
      return json([{ id: 1, status: 'Running', is_provided_by__release: { __id: 50 }, installs__image: [{ id: 77, is_a_build_of__service: [{ id: 2, service_name: 'core' }] }] }]);
    // A filter on a record id (`id eq N`, not `…_application eq N`) returns that record only if it is the known one.
    const byId = /(^|[^_a-z])id eq (\d+)/.exec(path)?.[2];
    if (path.startsWith('/v7/release'))
      return json(byId ? (byId === '60' ? [{ id: 60, raw_version: '2.0.0' }] : []) : [{ id: 60, commit: 'c0ffee00', raw_version: '2.0.0', status: 'success', created_at: '2026-10-01', belongs_to__application: { __id: 10 } }]);
    if (path.startsWith('/v7/device_tag'))
      return json(byId ? (byId === '8' ? [{ id: 8, tag_key: 'site' }] : []) : [{ id: 8, tag_key: 'site', value: 'A' }]);
    if (path.startsWith('/v7/user(')) return json([{ username: 'kunde' }]);
    if (path.startsWith('/v7/organization(')) return json([{ name: 'org-1' }]);
    if (path.startsWith('/v7/user__has__public_key')) return json(opts.publicKeys ?? []);
    if (path.startsWith('/device/v2/')) return { ok: true, status: 200, json: async () => [{ message: 'hello', timestamp: 1, serviceId: 2, isStderr: false, isSystem: false, secret: 'x' }] };
    return json([]);
  }) as any;
  const token = () => new SignJWT({ id: 5 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  return { calls, token };
}
