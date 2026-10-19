// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { openStore, setStore, PermissionStore } from '../../permissions/store';
import auditRoutes from '../routes';

const SECRET = 'test-secret';
const sign = (id: number) => new SignJWT({ id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const app = express();
app.use(express.json());
app.use('/', auditRoutes);

let store: PermissionStore;
beforeEach(() => {
  process.env.OPEN_BALENA_JWT_SECRET = SECRET;
  process.env.OPEN_BALENA_API_URL = 'https://api.example';
  process.env.OPEN_BALENA_SERVICE_API_KEY = 'svc';
  store = openStore(':memory:');
  store.assignUser(1, store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true }).id);
  store.assignUser(5, store.createSet({ name: 'C', capabilities: ['device.read'] }).id);
  setStore(store);
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ d: [{ id: 1 }, { id: 5 }] }) })) as any;
});

const as = async (id: number) => ({ Authorization: `Bearer ${await sign(id)}` });
const add = (over: Record<string, unknown> = {}) =>
  store.recordAudit({ userId: 5, username: 'cust', fleetId: 100, fleetName: 'F', action: 'device.reboot', result: 'ok', ...over } as any);

describe('admin audit API', () => {
  it('refuses a customer token', async () => {
    expect((await request(app).get('/api/admin/audit').set(await as(5))).status).toBe(403);
    expect((await request(app).get('/api/admin/audit/filters').set(await as(5))).status).toBe(403);
  });
  it('refuses a request without a token', async () => {
    expect((await request(app).get('/api/admin/audit')).status).toBe(401);
  });
  it('returns rows in the documented shape with defaults', async () => {
    add({ orgId: 10, orgName: 'Org', deviceUuid: 'u', deviceName: 'd', details: { a: 1 } });
    const res = await request(app).get('/api/admin/audit').set(await as(1));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      ['action', 'details', 'deviceName', 'deviceUuid', 'error', 'fleetId', 'fleetName', 'id', 'orgId', 'orgName', 'result', 'ts', 'userId', 'username'],
    );
    expect(res.body.data[0].details).toEqual({ a: 1 });
  });
  it.each([
    'page=0',
    'page=abc',
    'page=1.5',
    'perPage=0',
    'perPage=201',
    'perPage=x',
    'userId=0',
    'userId=-1',
    'userId=a',
    'fleetId=0',
    'fleetId=1.5',
    'action=nope',
    'action=device.reboot&action=ssh.set',
  ])('rejects %s with 400', async (qs) => {
    const res = await request(app).get(`/api/admin/audit?${qs}`).set(await as(1));
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe('string');
  });
  it('combines filters and pages', async () => {
    add({ userId: 5, fleetId: 100, action: 'device.reboot' });
    add({ userId: 6, fleetId: 100, action: 'device.reboot' });
    add({ userId: 6, fleetId: 200, action: 'ssh.set' });
    const h = await as(1);
    expect((await request(app).get('/api/admin/audit?userId=6&fleetId=100&action=device.reboot').set(h)).body.total).toBe(1);
    const p = await request(app).get('/api/admin/audit?perPage=1&page=2').set(h);
    expect(p.body.total).toBe(3);
    expect(p.body.data).toHaveLength(1);
  });
  it('serves filter values', async () => {
    add();
    const res = await request(app).get('/api/admin/audit/filters').set(await as(1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: [{ id: 5, username: 'cust' }], fleets: [{ id: 100, name: 'F' }], actions: ['device.reboot'] });
  });
});
