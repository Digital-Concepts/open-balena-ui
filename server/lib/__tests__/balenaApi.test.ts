// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { odataGet, odataCount, odataQuery, odataString, refId, apiPost } from '../balenaApi';
import { HttpError } from '../httpError';

const mockFetch = (status: number, body: unknown) => {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })) as any;
};

beforeEach(() => {
  process.env.OPEN_BALENA_API_URL = 'https://api.example';
  process.env.OPEN_BALENA_SERVICE_API_KEY = 'svc';
});

describe('balenaApi', () => {
  it('keeps OData syntax raw, encodes spaces and skips empty params', () => {
    expect(
      odataQuery('image_install', { $select: 'id,status', $expand: 'installs__image($select=id;$expand=x)', $filter: "a eq 'b'", $top: undefined }),
    ).toBe("image_install?$select=id,status&$expand=installs__image($select=id;$expand=x)&$filter=a%20eq%20'b'");
  });
  it('rejects query values containing &, # or control characters', () => {
    for (const bad of ['a&b', 'a#b', 'a\nb', 'a\x00b', 'a\x7fb']) {
      expect(() => odataQuery('device', { $filter: bad })).toThrow(HttpError);
    }
    expect(() => odataQuery('device', { $filter: 'a&b' })).toThrow('Invalid query value');
  });
  it('doubles quotes and fully encodes string literals', () => {
    expect(odataString("a') or (1 eq 1&x,y")).toBe("'a%27%27%29%20or%20%281%20eq%201%26x%2Cy'");
  });
  it('resolves navigation ids', () => {
    expect(refId({ __id: 4 })).toBe(4);
    expect(refId([{ id: 9 }])).toBe(9);
    expect(refId(3)).toBe(3);
    expect(refId(null)).toBeNull();
  });
  it('GETs with the service key and unwraps d', async () => {
    mockFetch(200, { d: [{ id: 1 }] });
    expect(await odataGet('device')).toEqual([{ id: 1 }]);
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.example/v7/device');
    expect(init.headers.Authorization).toBe('Bearer svc');
  });
  it('counts', async () => {
    mockFetch(200, { d: 12 });
    expect(await odataCount('device', 'is_online eq true')).toBe(12);
    expect((global.fetch as any).mock.calls[0][0]).toBe('https://api.example/v7/device/$count?$filter=is_online%20eq%20true');
  });
  it('503 when the key is missing', async () => {
    delete process.env.OPEN_BALENA_SERVICE_API_KEY;
    await expect(odataGet('device')).rejects.toMatchObject({ status: 503 });
  });
  it('503 when the key is rejected, 502 on other upstream errors', async () => {
    mockFetch(401, {});
    await expect(odataGet('device')).rejects.toMatchObject({ status: 503 });
    mockFetch(500, {});
    await expect(odataGet('device')).rejects.toMatchObject({ status: 502 });
  });
  it('502 when unreachable', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as any;
    await expect(odataGet('device')).rejects.toBeInstanceOf(HttpError);
  });
  it('apiPost returns text', async () => {
    mockFetch(200, 'OK');
    expect(await apiPost('/supervisor/v1/reboot', { uuid: 'x' })).toBe('OK');
  });
});
