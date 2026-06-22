// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import housekeeperRoutes from '../housekeeper';

// authorize uses jose jwtVerify with OPEN_BALENA_JWT_SECRET (HS256). Easiest: set a
// secret and pass a token authorize accepts. To avoid crypto in tests, mock the
// middleware module so authorize is a pass-through and dosProtect is empty.
vi.mock('../../middleware', () => ({
  authorize: (_req: any, _res: any, next: any) => next(),
  dosProtect: [],
}));

const app = express();
app.use(express.json());
app.use('/', housekeeperRoutes);

beforeEach(() => {
  process.env.HOUSEKEEPER_URL = 'http://hk:7000';
  process.env.HOUSEKEEPER_TOKEN = 'hk-token';
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

describe('housekeeper BFF', () => {
  it('GET /housekeeper/status proxies with token', async () => {
    mockFetch(200, { status: 'idle' });
    const res = await request(app).get('/housekeeper/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('idle');
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('http://hk:7000/status');
    expect(call[1].headers.Authorization).toBe('Bearer hk-token');
  });

  it('PUT /housekeeper/config forwards body', async () => {
    mockFetch(200, { schedule: '0 4 * * *' });
    const res = await request(app).put('/housekeeper/config').send({ schedule: '0 4 * * *' });
    expect(res.status).toBe(200);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[1].method).toBe('PUT');
    expect(JSON.parse(call[1].body).schedule).toBe('0 4 * * *');
  });

  it('PUT /housekeeper/config passes through 400 + body', async () => {
    mockFetch(400, { errors: ['window_days: must be an integer > 0'] });
    const res = await request(app).put('/housekeeper/config').send({ window_days: 0 });
    expect(res.status).toBe(400);
    expect(res.body.errors[0]).toContain('window_days');
  });

  it('POST /housekeeper/run passes through 202 {run_id}', async () => {
    mockFetch(202, { run_id: '20260622-030000' });
    const res = await request(app).post('/housekeeper/run').send({ fleets: ['MASTER'], window_days: 7 });
    expect(res.status).toBe(202);
    expect(res.body.run_id).toBe('20260622-030000');
  });

  it('POST /housekeeper/run passes through 409', async () => {
    mockFetch(409, { error: 'a housekeeping run is already in progress' });
    const res = await request(app).post('/housekeeper/run').send({});
    expect(res.status).toBe(409);
  });

  it('GET /housekeeper/runs/:id/log returns text', async () => {
    mockFetch(200, 'line1\nline2', 'text/plain');
    const res = await request(app).get('/housekeeper/runs/r1/log');
    expect(res.status).toBe(200);
    expect(res.text).toContain('line1');
  });

  it('GET /housekeeper/fleets proxies', async () => {
    mockFetch(200, { fleets: [{ name: 'MASTER', id: 17 }] });
    const res = await request(app).get('/housekeeper/fleets');
    expect(res.body.fleets[0].name).toBe('MASTER');
  });

  it('missing HOUSEKEEPER_TOKEN -> 500', async () => {
    delete process.env.HOUSEKEEPER_TOKEN;
    const res = await request(app).get('/housekeeper/status');
    expect(res.status).toBe(500);
  });
});
