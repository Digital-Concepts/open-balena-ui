// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { openStore, setStore, PermissionStore } from '../store';
import permissionRoutes from '../routes';

const SECRET = 'test-secret';
const sign = (id: number) => new SignJWT({ id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const app = express();
app.use(express.json());
app.use('/', permissionRoutes);

let store: PermissionStore;
let adminSetId: number;
beforeEach(() => {
  process.env.OPEN_BALENA_JWT_SECRET = SECRET;
  process.env.OPEN_BALENA_API_URL = 'https://api.example';
  process.env.OPEN_BALENA_SERVICE_API_KEY = 'svc';
  store = openStore(':memory:');
  adminSetId = store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true }).id;
  store.assignUser(1, adminSetId);
  store.assignUser(5, store.createSet({ name: 'C', capabilities: ['device.read'] }).id);
  setStore(store);
  process.env.ADMIN_UI_POSTGREST_URL = 'https://postgrest.example';
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ d: [{ id: 1 }, { id: 5 }] }) })) as any;
});

const as = async (id: number) => ({ Authorization: `Bearer ${await sign(id)}` });

describe('admin permission API', () => {
  it('customers are refused', async () => {
    expect((await request(app).get('/api/admin/permission-sets').set(await as(5))).status).toBe(403);
  });
  it('CRUD a set', async () => {
    const h = await as(1);
    const created = await request(app).post('/api/admin/permission-sets').set(h).send({ name: 'RO', capabilities: ['device.read'] });
    expect(created.status).toBe(200);
    const id = created.body.id;
    expect((await request(app).put(`/api/admin/permission-sets/${id}`).set(h).send({ capabilities: ['device.logs'] })).body.capabilities).toEqual(['device.read', 'device.logs']);
    expect((await request(app).get('/api/admin/permission-sets').set(h)).body.total).toBe(3);
    expect((await request(app).delete(`/api/admin/permission-sets/${id}`).set(h)).body).toEqual({ id });
  });
  it('rejects requests without a token', async () => {
    expect((await request(app).get('/api/admin/permission-sets')).status).toBe(401);
  });
  it('ignores a builtin flag in the create body', async () => {
    const res = await request(app)
      .post('/api/admin/permission-sets')
      .set(await as(1))
      .send({ name: 'X', capabilities: ['device.read'], builtin: true });
    expect(res.body.builtin).toBe(false);
  });
  it('refuses to demote the last live admin even with a stale admin row', async () => {
    store.assignUser(42, adminSetId);
    const res = await request(app)
      .put('/api/admin/users/1/permission-set')
      .set(await as(1))
      .send({ permissionSetId: null });
    expect(res.status).toBe(409);
  });
  it('maps store errors to status codes', async () => {
    const h = await as(1);
    expect((await request(app).put(`/api/admin/permission-sets/${adminSetId}`).set(h).send({ name: 'X' })).status).toBe(409);
    expect((await request(app).post('/api/admin/permission-sets').set(h).send({ name: 'Y', capabilities: ['nope'] })).status).toBe(400);
    expect((await request(app).get('/api/admin/permission-sets/999').set(h)).status).toBe(404);
  });
  it('assigns users and protects the last admin', async () => {
    const h = await as(1);
    expect((await request(app).put('/api/admin/users/7/permission-set').set(h).send({ permissionSetId: adminSetId })).body).toEqual({ userId: 7, permissionSetId: adminSetId });
    expect((await request(app).get('/api/admin/users/8/permission-set').set(h)).body).toEqual({ userId: 8, permissionSetId: null });
    await request(app).put('/api/admin/users/7/permission-set').set(h).send({ permissionSetId: null });
    expect((await request(app).put('/api/admin/users/1/permission-set').set(h).send({ permissionSetId: null })).status).toBe(409);
  });
  it('lists assignments and prunes deleted users', async () => {
    store.assignUser(42, adminSetId);
    const res = await request(app).get('/api/admin/permission-assignments').set(await as(1));
    expect(res.body.data.map((a: any) => a.userId)).toEqual([1, 5]);
  });

  describe('terminal key revocation', () => {
    const keyFetch = (opts: { failDelete?: boolean } = {}) => {
      const calls: { method: string; url: string; auth?: string }[] = [];
      global.fetch = vi.fn(async (url: string, init?: any) => {
        const method = init?.method ?? 'GET';
        calls.push({ method, url: String(url), auth: init?.headers?.Authorization });
        if (method === 'DELETE' && opts.failDelete) return { ok: false, status: 500, json: async () => ({}) };
        if (method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ d: [{ id: 1 }, { id: 5 }, { id: 6 }] }) };
      }) as any;
      return calls;
    };
    const deletes = (calls: { method: string; url: string; auth?: string }[]) => calls.filter((c) => c.method === 'DELETE');

    it('unassigning a terminal-capable user deletes their remote key', async () => {
      const termSet = store.createSet({ name: 'T', capabilities: ['device.read', 'device.terminal'] });
      store.assignUser(6, termSet.id);
      const calls = keyFetch();
      const res = await request(app).put('/api/admin/users/6/permission-set').set(await as(1)).send({ permissionSetId: null });
      expect(res.status).toBe(200);
      const del = deletes(calls);
      expect(del).toHaveLength(1);
      expect(del[0].url).toBe('https://postgrest.example/user-has-public%20key?user=eq.6&title=eq.open-balena-remote');
      expect(del[0].auth).toBe(`Bearer ${await sign(1)}`);
    });

    it('assigning a set that keeps device.terminal does not delete keys', async () => {
      const termSet = store.createSet({ name: 'T', capabilities: ['device.read', 'device.terminal'] });
      const calls = keyFetch();
      const res = await request(app).put('/api/admin/users/6/permission-set').set(await as(1)).send({ permissionSetId: termSet.id });
      expect(res.status).toBe(200);
      expect(deletes(calls)).toEqual([]);
    });

    it('a revoke failure still returns 200', async () => {
      keyFetch({ failDelete: true });
      const res = await request(app).put('/api/admin/users/5/permission-set').set(await as(1)).send({ permissionSetId: null });
      expect(res.status).toBe(200);
    });

    it('removing device.terminal from a set revokes keys of its users', async () => {
      const termSet = store.createSet({ name: 'T', capabilities: ['device.read', 'device.terminal'] });
      store.assignUser(6, termSet.id);
      const calls = keyFetch();
      const res = await request(app).put(`/api/admin/permission-sets/${termSet.id}`).set(await as(1)).send({ capabilities: ['device.read'] });
      expect(res.status).toBe(200);
      expect(deletes(calls)).toHaveLength(1);
    });
  });
});
