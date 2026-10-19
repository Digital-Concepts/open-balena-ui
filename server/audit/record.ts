import type { RequestHandler } from 'express';
import { odataGet, odataQuery } from '../lib/balenaApi';
import { getStore, type PermissionStore } from '../permissions/store';
import type { AuditAction } from './actions';

const TTL_MS = 5 * 60_000;
const MAX_ERROR = 300;
const names = new Map<string, { value: string | null; expires: number }>();

export function clearAuditCache(): void {
  names.clear();
}

// Service-key name lookup, cached; failures give null and are not cached.
async function nameOf(resource: 'user' | 'application' | 'organization', id: number | null, field: string): Promise<string | null> {
  if (id === null) return null;
  const key = `${resource}:${id}`;
  const hit = names.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const [row] = await odataGet<Record<string, unknown>>(odataQuery(`${resource}(${id})`, { $select: field }));
    const value = typeof row?.[field] === 'string' ? (row[field] as string) : null;
    names.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  } catch {
    return null;
  }
}

const errorOf = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') return null;
  const b = body as { message?: unknown; error?: unknown };
  const msg = typeof b.message === 'string' ? b.message : typeof b.error === 'string' ? b.error : null;
  return msg && msg.slice(0, MAX_ERROR);
};

// Records one audit entry when the response ends, if the route loaded a device in scope.
// Streams report a disconnect as 'aborted'; for other routes the outcome is unknown.
export function audited(action: AuditAction, opts: { stream?: boolean } = {}): RequestHandler {
  return (req, res, next) => {
    let error: string | null = null;
    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      if (res.statusCode >= 400) error = errorOf(body);
      return json(body);
    };
    let done = false;
    const settle = (finished: boolean) => {
      if (done) return;
      done = true;
      const device = req.auditDevice;
      // Rate-limited (busy) requests are denials, not actions.
      if (!device || !req.user || res.statusCode === 429) return;
      let store: PermissionStore;
      try {
        store = getStore();
      } catch (err) {
        console.error('audit: store unavailable', err);
        return;
      }
      const ts = new Date().toISOString();
      const ok = finished && res.statusCode < 400;
      const userId = req.user.id;
      const details = req.auditDetails ?? null;
      const failure = ok ? null : finished ? error : opts.stream ? 'aborted' : 'client disconnected; outcome unknown';
      void (async () => {
        try {
          const orgId = store.getUserCustomerOrg(userId) ?? null;
          const [username, orgName, fleetName] = await Promise.all([
            nameOf('user', userId, 'username'),
            nameOf('organization', orgId, 'name'),
            nameOf('application', device.fleetId, 'app_name'),
          ]);
          store.recordAudit({
            ts,
            userId,
            username,
            orgId,
            orgName,
            fleetId: device.fleetId,
            fleetName,
            deviceUuid: device.uuid,
            deviceName: device.name,
            action,
            details,
            result: ok ? 'ok' : 'failed',
            error: failure,
          });
        } catch (err) {
          console.error(`audit: failed to record ${action}`, err);
        }
      })();
    };
    res.once('finish', () => settle(true));
    res.once('close', () => settle(res.writableFinished));
    next();
  };
}
