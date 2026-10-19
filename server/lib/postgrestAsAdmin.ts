import { HttpError } from '../lib/httpError';

const TLS_VERIFY_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

// Calls the PostgREST proxy with the acting admin's token; the proxy only admits admins.
export async function postgrestAsAdmin<T = unknown>(
  adminAuth: string | undefined,
  method: 'GET' | 'POST' | 'DELETE',
  resource: string,
  query = '',
  body?: unknown,
): Promise<T> {
  const base = (process.env.ADMIN_UI_POSTGREST_URL || process.env.REACT_APP_OPEN_BALENA_POSTGREST_URL || '').replace(/\/$/, '');
  if (!base || !adminAuth) throw new Error('PostgREST URL or admin token missing');
  const url = `${base}/${encodeURIComponent(resource)}${query ? `?${query}` : ''}`;
  const headers: Record<string, string> = { Authorization: adminAuth };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    if (code && TLS_VERIFY_CODES.has(code)) {
      throw new HttpError(
        502,
        `PostgREST TLS certificate not trusted (${code}) — the proxy must serve the full certificate chain`,
      );
    }
    throw new HttpError(502, code ? `PostgREST unreachable (${code})` : 'PostgREST unreachable');
  }
  if (!res.ok) throw new HttpError(502, `PostgREST responded ${res.status}`);
  if (method !== 'GET') return undefined as T;
  return (await res.json()) as T;
}
