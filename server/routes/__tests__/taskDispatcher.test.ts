// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import taskDispatcherRoutes from '../taskDispatcher';

// Stub the auth + rate-limit middleware so these tests exercise the proxy logic in isolation.
vi.mock('../../middleware', () => ({
  authorize: (_req: any, _res: any, next: any) => next(),
  dosProtect: [],
}));

const app = express();
app.use(express.json());
app.use('/', taskDispatcherRoutes);

beforeEach(() => {
  process.env.TASK_DISPATCHER_URL = 'http://td:7000';
  process.env.TASK_DISPATCHER_TOKEN = 'td-token';
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: any) {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })) as any;
}

describe('task-dispatcher BFF', () => {
  it('POST /task-dispatcher/command proxies to /task/admin/tasks with the injected token and body', async () => {
    mockFetch(201, { task_id: 7, status: 'pending' });
    const res = await request(app)
      .post('/task-dispatcher/command')
      .send({ name: 'reboot', device_name: '0593C17F-03021007' });
    expect(res.status).toBe(201);
    expect(res.body.task_id).toBe(7);
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('http://td:7000/task/admin/tasks');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers.Authorization).toBe('Bearer td-token');
    expect(JSON.parse(call[1].body)).toEqual({ name: 'reboot', device_name: '0593C17F-03021007' });
  });

  it('passes through a 404 for an unknown gateway', async () => {
    mockFetch(404, { error: 'Unknown gateway' });
    const res = await request(app)
      .post('/task-dispatcher/command')
      .send({ name: 'reboot', device_name: 'FFFFFFFF-nope' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Unknown gateway');
  });

  it('returns 500 when the token is not configured', async () => {
    delete process.env.TASK_DISPATCHER_TOKEN;
    const res = await request(app).post('/task-dispatcher/command').send({ name: 'reboot' });
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/TASK_DISPATCHER_TOKEN/);
  });
});
