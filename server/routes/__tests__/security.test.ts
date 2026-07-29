// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import securityRoutes from '../security';

// Stub the auth + rate-limit middleware so these tests exercise the proxy logic in isolation.
vi.mock('../../middleware', () => ({
  authorize: (_req: any, _res: any, next: any) => next(),
  dosProtect: [],
}));

const app = express();
app.use(express.json());
app.use('/', securityRoutes);

beforeEach(() => {
  process.env.SECURITY_URL = 'http://sa:7100';
  process.env.SECURITY_TOKEN = 'sa-token';
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: any, contentType = 'application/json') {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })) as any;
}

describe('security BFF — fleets', () => {
  it('GET /security/fleets proxies with token', async () => {
    mockFetch(200, [{ fleet: 'release_OPUS_Pi3' }]);
    const res = await request(app).get('/security/fleets');
    expect(res.status).toBe(200);
    expect(res.body[0].fleet).toBe('release_OPUS_Pi3');
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('http://sa:7100/fleets');
    expect(call[1].headers.Authorization).toBe('Bearer sa-token');
  });

  it('GET /security/fleets/:fleet/releases encodes the fleet name', async () => {
    mockFetch(200, [{ release: '2.0.004' }]);
    const res = await request(app).get('/security/fleets/release_OPUS_Pi3/releases');
    expect(res.status).toBe(200);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('http://sa:7100/fleets/release_OPUS_Pi3/releases');
  });

  it('GET /security/fleets/:fleet/releases/:release returns the envelope', async () => {
    mockFetch(200, { fleet: 'release_OPUS_Pi3', release: '2.0.004', containers: [] });
    const res = await request(app).get('/security/fleets/release_OPUS_Pi3/releases/2.0.004');
    expect(res.status).toBe(200);
    expect(res.body.release).toBe('2.0.004');
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('http://sa:7100/fleets/release_OPUS_Pi3/releases/2.0.004');
  });

  it('GET /security/fleets/.../sbom/:service returns the SBOM JSON', async () => {
    mockFetch(200, { bomFormat: 'CycloneDX' });
    const res = await request(app)
      .get('/security/fleets/release_OPUS_Pi3/releases/2.0.004/sbom/Valkey');
    expect(res.status).toBe(200);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('http://sa:7100/fleets/release_OPUS_Pi3/releases/2.0.004/sbom/Valkey');
  });

  it('passes through a 404 for an unknown release', async () => {
    mockFetch(404, { status: 'failed', message: 'not found' });
    const res = await request(app).get('/security/fleets/release_OPUS_Pi3/releases/9.9.9');
    expect(res.status).toBe(404);
  });
});
