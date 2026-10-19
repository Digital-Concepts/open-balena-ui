import type { Request } from 'express';
import { DEVICE_SELECT } from '../lib/balenaFields';
import { odataGet, odataQuery, refId } from '../lib/balenaApi';
import { HttpError } from '../lib/httpError';
import { hasCapability } from '../permissions/capabilities';
import { getStore } from '../permissions/store';

export type Scope = { all: true } | { all: false; fleetIds: number[] };

export type RawDevice = {
  id: number;
  uuid: string;
  [field: string]: unknown;
};

export const POSITIVE_INT_RE = /^[1-9]\d{0,14}$/;
const TTL_MS = 30_000;
const UUID_RE = /^[0-9a-f]{32,62}$/;
const cache = new Map<number, { fleetIds: number[]; expires: number }>();

export function clearScopeCache(): void {
  cache.clear();
}

const anyOf = (field: string, ids: number[]) => ids.map((id) => `${field} eq ${id}`).join(' or ');

// Customer users see only the fleets of their linked org (decided by the admin UI store, not openBalena memberships);
// everyone else sees the fleets of every org they are a member of.
export async function fleetIdsFor(userId: number): Promise<number[]> {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.fleetIds;
  const linkedOrg = getStore().getUserCustomerOrg(userId);
  let orgIds: number[];
  if (linkedOrg !== undefined) {
    orgIds = [linkedOrg];
  } else {
    const memberships = await odataGet<{ is_member_of__organization: unknown }>(
      odataQuery('organization_membership', { $select: 'is_member_of__organization', $filter: `user eq ${userId}` }),
    );
    orgIds = memberships.map((m) => refId(m.is_member_of__organization)).filter((id): id is number => id !== null);
  }
  let fleetIds: number[] = [];
  if (orgIds.length) {
    const fleets = await odataGet<{ id: number }>(
      odataQuery('application', { $select: 'id', $filter: anyOf('organization', orgIds) }),
    );
    fleetIds = fleets.map((f) => f.id);
  }
  cache.set(userId, { fleetIds, expires: Date.now() + TTL_MS });
  return fleetIds;
}

export async function scopeFor(req: Request): Promise<Scope> {
  if (hasCapability(req.capabilities ?? [], 'admin')) return { all: true };
  return { all: false, fleetIds: await fleetIdsFor(req.user!.id) };
}

export function scopeFilter(scope: Scope, field: string): string | null {
  if (scope.all) return null;
  if (!scope.fleetIds.length) return `${field} eq -1`;
  return anyOf(field, scope.fleetIds);
}

export function inScope(scope: Scope, fleetId: number | null): boolean {
  return scope.all || (fleetId !== null && scope.fleetIds.includes(fleetId));
}

async function inScopeOrThrow(req: Request, device: RawDevice | undefined): Promise<RawDevice> {
  if (!device) throw new HttpError(403, 'Device not accessible');
  const scope = await scopeFor(req);
  if (!inScope(scope, refId(device.belongs_to__application))) throw new HttpError(403, 'Device not accessible');
  return device;
}

// Loads req.params.uuid; unknown and out-of-scope devices are indistinguishable (403).
export async function loadDeviceInScope(req: Request): Promise<RawDevice> {
  const uuid = String(req.params.uuid ?? '');
  if (!UUID_RE.test(uuid)) throw new HttpError(403, 'Device not accessible');
  const [device] = await odataGet<RawDevice>(
    odataQuery('device', { $select: DEVICE_SELECT, $filter: `uuid eq '${uuid}'` }),
  );
  return inScopeOrThrow(req, device);
}

// Loads the device with numeric id req.params.id; same 403 rules as loadDeviceInScope.
export async function loadDeviceByIdInScope(req: Request): Promise<RawDevice> {
  const raw = String(req.params.id ?? '');
  if (!POSITIVE_INT_RE.test(raw)) throw new HttpError(403, 'Device not accessible');
  const [device] = await odataGet<RawDevice>(
    odataQuery('device', { $select: DEVICE_SELECT, $filter: `id eq ${Number(raw)}` }),
  );
  return inScopeOrThrow(req, device);
}
