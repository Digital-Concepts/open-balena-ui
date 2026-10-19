export async function customerApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/customer${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('auth') ?? ''}`,
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message ?? res.statusText), { status: res.status });
  return body as T;
}
