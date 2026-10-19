export type Me = { userId: number; permissionSet: { id: number; name: string }; capabilities: string[] };
export type Permissions = { status: 'ok'; me: Me } | { status: 'no-access' };

let cached: { token: string; promise: Promise<Permissions> } | null = null;

async function fetchPermissions(token: string): Promise<Permissions> {
  const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 403) return { status: 'no-access' };
  if (res.ok) return { status: 'ok', me: (await res.json()) as Me };
  throw Object.assign(new Error(res.statusText), { status: res.status });
}

// Permissions come from the UI server; a reload or re-login picks up changes.
// The in-flight request is shared per token; a failed request is not cached.
export function loadPermissions(token: string): Promise<Permissions> {
  if (cached?.token === token) return cached.promise;
  const promise = fetchPermissions(token);
  cached = { token, promise };
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}

export function clearPermissionsCache(): void {
  cached = null;
}

export const isAdmin = (p?: Permissions): boolean => p?.status === 'ok' && p.me.capabilities.includes('admin');

export const can = (p: Permissions | undefined, cap: string): boolean =>
  p?.status === 'ok' && (p.me.capabilities.includes('admin') || p.me.capabilities.includes(cap));
