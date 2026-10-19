// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { verifySession, clearSessionCache } =
  await vi.importActual<typeof import('../sessionCheck')>('../sessionCheck');

const reply = (status: number, body: unknown = {}) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  process.env.OPEN_BALENA_API_URL = 'https://api.example/';
  clearSessionCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('verifySession', () => {
  it('accepts a live session and caches it', async () => {
    const fetchMock = reply(200, { id: 5 });
    vi.stubGlobal('fetch', fetchMock);
    await verifySession('tok', 5);
    await verifySession('tok', 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example/user/v1/whoami');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer tok' });
  });
  it('401 when openBalena rejects the token (user deleted / password changed)', async () => {
    vi.stubGlobal('fetch', reply(401));
    await expect(verifySession('tok', 5)).rejects.toMatchObject({ status: 401 });
  });
  it('401 when the session belongs to another user', async () => {
    vi.stubGlobal('fetch', reply(200, { id: 6 }));
    await expect(verifySession('tok', 5)).rejects.toMatchObject({ status: 401 });
  });
  it('does not cache rejections', async () => {
    vi.stubGlobal('fetch', reply(401));
    await expect(verifySession('tok', 5)).rejects.toMatchObject({ status: 401 });
    vi.stubGlobal('fetch', reply(200, { id: 5 }));
    await expect(verifySession('tok', 5)).resolves.toBeUndefined();
  });
  it('fails closed with 503 when the API is unreachable or erroring', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(verifySession('tok', 5)).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal('fetch', reply(500));
    await expect(verifySession('tok', 5)).rejects.toMatchObject({ status: 503 });
  });
  it('503 when no API URL is configured', async () => {
    process.env.OPEN_BALENA_API_URL = '';
    delete process.env.REACT_APP_OPEN_BALENA_API_URL;
    await expect(verifySession('tok', 5)).rejects.toMatchObject({ status: 503 });
  });
});
