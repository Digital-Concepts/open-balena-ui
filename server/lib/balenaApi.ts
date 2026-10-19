import { HttpError } from './httpError';
import { ODATA_VERSION } from './balenaFields';

const apiBase = () =>
  (process.env.OPEN_BALENA_API_URL || process.env.REACT_APP_OPEN_BALENA_API_URL || '').replace(/\/$/, '');

export const serviceKeyConfigured = (): boolean => Boolean(process.env.OPEN_BALENA_SERVICE_API_KEY && apiBase());

// Pine returns navigation properties as {__id}, as expanded arrays, or as plain ids.
export function refId(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return refId(v[0]);
  if (typeof v === 'object') {
    const o = v as { __id?: unknown; id?: unknown };
    if (typeof o.__id === 'number') return o.__id;
    if (typeof o.id === 'number') return o.id;
  }
  return null;
}

export function expanded<T>(v: unknown): T | null {
  return Array.isArray(v) && v.length ? (v[0] as T) : null;
}

// Pine rejects percent-encoded OData syntax ( ( ) , ; ), so structural text is sent raw with only spaces
// encoded. User-supplied text must go through odataString, which encodes it completely.
export function odataQuery(resource: string, params: Record<string, string | number | undefined | null>): string {
  for (const v of Object.values(params)) {
    if (v !== undefined && v !== null && /[&#\x00-\x1f\x7f]/.test(String(v))) throw new HttpError(400, 'Invalid query value');
  }
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v).replace(/ /g, '%20')}`);
  return parts.length ? `${resource}?${parts.join('&')}` : resource;
}

const encodeLiteral = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const odataString = (s: string): string => `'${encodeLiteral(s.replace(/'/g, "''"))}'`;

// With userAuth (a caller's own Authorization header) the call acts as that user instead of the service key.
async function call(method: string, path: string, body?: unknown, userAuth?: string): Promise<Response> {
  const key = process.env.OPEN_BALENA_SERVICE_API_KEY;
  const base = apiBase();
  if (!base || (!userAuth && !key)) throw new HttpError(503, 'Customer API not configured');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: userAuth ?? `Bearer ${key}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new HttpError(502, 'balena API unreachable');
  }
  if (res.status === 401 || res.status === 403) {
    if (userAuth) throw new HttpError(403, 'Rejected by balena API');
    throw new HttpError(503, 'Service API key rejected by balena API');
  }
  if (!res.ok) throw new HttpError(502, `balena API responded ${res.status}`);
  return res;
}

export async function odataGet<T>(query: string): Promise<T[]> {
  const res = await call('GET', `/${ODATA_VERSION}/${query}`);
  return ((await res.json()) as { d: T[] }).d;
}

export async function odataGetAs<T>(userAuth: string, query: string): Promise<T[]> {
  const res = await call('GET', `/${ODATA_VERSION}/${query}`, undefined, userAuth);
  return ((await res.json()) as { d: T[] }).d;
}

export async function odataPostAs<T>(userAuth: string, resource: string, body: unknown): Promise<T> {
  const res = await call('POST', `/${ODATA_VERSION}/${resource}`, body, userAuth);
  return (await res.json()) as T;
}

export async function odataDeleteAs(userAuth: string, resource: string): Promise<void> {
  await call('DELETE', `/${ODATA_VERSION}/${resource}`, undefined, userAuth);
}

export async function odataCount(resource: string, filter?: string | null): Promise<number> {
  const res = await call('GET', `/${ODATA_VERSION}/${odataQuery(`${resource}/$count`, { $filter: filter })}`);
  return ((await res.json()) as { d: number }).d;
}

export async function odataPost<T>(resource: string, body: unknown): Promise<T> {
  const res = await call('POST', `/${ODATA_VERSION}/${resource}`, body);
  return (await res.json()) as T;
}

export async function odataPatch(resource: string, body: unknown): Promise<void> {
  await call('PATCH', `/${ODATA_VERSION}/${resource}`, body);
}

export async function odataDelete(resource: string): Promise<void> {
  await call('DELETE', `/${ODATA_VERSION}/${resource}`);
}

export async function apiPost(path: string, body: unknown): Promise<string> {
  const res = await call('POST', path, body);
  return res.text();
}

export async function apiGetJson<T>(path: string): Promise<T> {
  const res = await call('GET', path);
  return (await res.json()) as T;
}
