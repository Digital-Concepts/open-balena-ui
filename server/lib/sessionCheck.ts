import { createHash } from 'node:crypto';
import { HttpError } from './httpError';

const TTL_MS = 60_000;
const MAX_ENTRIES = 5000;
const cache = new Map<string, number>();

const apiBase = () =>
  (process.env.OPEN_BALENA_API_URL || process.env.REACT_APP_OPEN_BALENA_API_URL || '').replace(/\/$/, '');

export function clearSessionCache(): void {
  cache.clear();
}

// Asks openBalena whether the token is still accepted (user exists, password not changed since issue) and belongs to `id`.
export async function verifySession(token: string, id: number): Promise<void> {
  const key = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  const until = cache.get(key);
  if (until && until > now) return;

  const base = apiBase();
  if (!base) throw new HttpError(503, 'Session check not configured');
  let res: Response;
  try {
    res = await fetch(`${base}/user/v1/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError(503, 'Session check failed: balena API unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Session no longer valid');
  if (!res.ok) throw new HttpError(503, `Session check failed: balena API responded ${res.status}`);
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (body?.id !== id) throw new HttpError(401, 'Session no longer valid');

  if (cache.size >= MAX_ENTRIES) {
    for (const [k, v] of cache) if (v <= now) cache.delete(k);
    if (cache.size >= MAX_ENTRIES) cache.clear();
  }
  cache.set(key, now + TTL_MS);
}
