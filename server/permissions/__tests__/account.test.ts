// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { openStore, setStore, PermissionStore } from '../store';
import permissionRoutes from '../routes';

const SECRET = 'test-secret';
const sign = (id: number) => new SignJWT({ id }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(SECRET));
const app = express();
app.use(express.json());
app.use('/', permissionRoutes);

type Call = { method: string; url: string; auth?: string; body?: unknown };
const PG = 'https://postgrest.example';
const MEMB = `${PG}/organization%20membership`;
const ROLES = `${PG}/user-has-role`;
const ROLE = `${PG}/role`;
const PERMS = `${PG}/user-has-permission`;
const SEL_M = 'select=id,%22is%20member%20of-organization%22';

let store: PermissionStore;
let calls: Call[];
let adminSetId: number;
let custSetId: number;
let db: { memberships: { id: number; org: number }[]; roles: { id: number; role: number }[]; perms: { id: number }[]; failOn?: string };

const as = async (id: number) => ({ Authorization: `Bearer ${await sign(id)}` });

const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });

beforeEach(() => {
  process.env.OPEN_BALENA_JWT_SECRET = SECRET;
  process.env.OPEN_BALENA_API_URL = 'https://api.example';
  process.env.OPEN_BALENA_SERVICE_API_KEY = 'svc';
  process.env.ADMIN_UI_POSTGREST_URL = PG;
  store = openStore(':memory:');
  adminSetId = store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true }).id;
  store.assignUser(1, adminSetId);
  store.assignUser(2, adminSetId);
  custSetId = store.createSet({ name: 'Cust', capabilities: ['device.read', 'device.logs'] }).id;
  store.setOrgSettings(10, { permissionSetId: custSetId });
  setStore(store);
  calls = [];
  db = { memberships: [{ id: 100, org: 99 }], roles: [{ id: 200, role: 7 }], perms: [{ id: 300 }] };
  global.fetch = vi.fn(async (url: string, init?: any) => {
    const method = init?.method ?? 'GET';
    const u = String(url);
    calls.push({ method, url: u, auth: init?.headers?.Authorization, body: init?.body ? JSON.parse(init.body) : undefined });
    if (db.failOn && u.startsWith(db.failOn) && method !== 'GET') return json({}, 500);
    if (u.startsWith(`${MEMB}?user=eq.7`) && method === 'GET')
      return json(db.memberships.map((m) => ({ id: m.id, 'is member of-organization': m.org })));
    if (u.startsWith(`${ROLE}?name=eq.default-user`)) return json([{ id: 3 }]);
    if (u.startsWith(`${ROLES}?user=eq.7`) && method === 'GET') return json(db.roles.map((r) => ({ id: r.id, role: r.role })));
    if (u.startsWith(`${PERMS}?user=eq.7`) && method === 'GET') return json(db.perms);
    if (u.includes('user-has-public')) return json({}, 204);
    if (u.includes('/user?') || u.includes('/user')) return json({ d: [{ id: 1 }, { id: 2 }, { id: 7 }] });
    return json({}, method === 'DELETE' ? 204 : 201);
  }) as any;
});

const pg = () => calls.filter((c) => c.url.startsWith(PG) && !c.url.includes('user-has-public'));

describe('org settings routes', () => {
  it('GET/PUT org settings', async () => {
    const h = await as(1);
    expect((await request(app).get('/api/admin/orgs/10/settings').set(h)).body).toEqual({ orgId: 10, isCustomer: true, permissionSetId: custSetId, userCount: 0 });
    const put = await request(app).put('/api/admin/orgs/11/settings').set(h).send({ permissionSetId: custSetId });
    expect(put.body).toEqual({ orgId: 11, isCustomer: true, permissionSetId: custSetId, userCount: 0 });
    expect((await request(app).put('/api/admin/orgs/11/settings').set(h).send({})).status).toBe(400);
  });
  it('PUT ignores a legacy isCustomer field', async () => {
    const h = await as(1);
    const put = await request(app).put('/api/admin/orgs/12/settings').set(h).send({ isCustomer: false, permissionSetId: custSetId });
    expect(put.body).toEqual({ orgId: 12, isCustomer: true, permissionSetId: custSetId, userCount: 0 });
  });
  it('GET /org-settings lists all rows, admin only', async () => {
    store.setUserCustomer(7, 10);
    const res = await request(app).get('/api/admin/org-settings').set(await as(1));
    expect(res.status).toBe(200);
    expect(res.body.data).toContainEqual({ orgId: 10, isCustomer: true, permissionSetId: custSetId, userCount: 1 });
    expect((await request(app).get('/api/admin/org-settings').set(await as(7))).status).toBe(403);
  });
  it('409 naming the count while users are linked', async () => {
    store.setUserCustomer(7, 10);
    const res = await request(app).put('/api/admin/orgs/10/settings').set(await as(1)).send({ permissionSetId: null });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 linked user/);
  });
  it('non-admins are refused', async () => {
    store.setUserCustomer(7, 10);
    expect((await request(app).get('/api/admin/orgs/10/settings').set(await as(7))).status).toBe(403);
  });
  it('409 deleting a set referenced by an org', async () => {
    expect((await request(app).delete(`/api/admin/permission-sets/${custSetId}`).set(await as(1))).status).toBe(409);
  });
  it('changing the org set to one without terminal revokes linked users keys', async () => {
    const term = store.createSet({ name: 'T', capabilities: ['device.read', 'device.terminal'] });
    store.setOrgSettings(11, { permissionSetId: term.id });
    store.setUserCustomer(7, 11);
    const res = await request(app).put('/api/admin/orgs/11/settings').set(await as(1)).send({ permissionSetId: custSetId });
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.method === 'DELETE' && c.url.includes('user-has-public'))).toHaveLength(1);
  });
});

describe('account routes', () => {
  it('stale memberships are deleted before the new one is added', async () => {
    // Only the POST fails, so the deletes have already happened.
    const orig = global.fetch as any;
    global.fetch = vi.fn(async (url: string, init?: any) => {
      if ((init?.method ?? 'GET') === 'POST' && String(url).startsWith(MEMB)) {
        calls.push({ method: 'POST', url: String(url) });
        return json({}, 500);
      }
      return orig(url, init);
    }) as any;
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(res.status).toBe(502);
    const order = calls.filter((c) => c.url.startsWith(MEMB)).map((c) => c.method);
    expect(order.indexOf('DELETE')).toBeGreaterThan(-1);
    expect(order.indexOf('DELETE')).toBeLessThan(order.indexOf('POST'));
    expect(store.getUserCustomerOrg(7)).toBeUndefined();
  });

  it('concurrent saves for one user serialize and end with one membership matching SQLite', async () => {
    store.setOrgSettings(11, { permissionSetId: custSetId });
    const mem: number[] = [99];
    global.fetch = vi.fn(async (url: string, init?: any) => {
      const method = init?.method ?? 'GET';
      const u = String(url);
      await new Promise((r) => setTimeout(r, 5));
      if (u.startsWith(`${MEMB}?user=eq.7`) && method === 'GET') return json(mem.map((o) => ({ id: o, 'is member of-organization': o })));
      if (u.startsWith(MEMB) && method === 'POST') { mem.push(JSON.parse(init.body)['is member of-organization']); return json({}, 201); }
      if (u.startsWith(MEMB) && method === 'DELETE') { mem.splice(mem.indexOf(Number(u.split('eq.')[1])), 1); return json({}, 204); }
      if (u.startsWith(`${ROLE}?`)) return json([{ id: 3 }]);
      if (u.startsWith(`${ROLES}?user=eq.7`)) return json([{ id: 3, role: 3 }]);
      if (u.startsWith(`${PERMS}?user=eq.7`)) return json([]);
      if (u.includes('/user')) return json({ d: [{ id: 1 }, { id: 2 }, { id: 7 }] });
      return json({}, 204);
    }) as any;
    const h = await as(1);
    const [a, b] = await Promise.all([
      request(app).put('/api/admin/users/7/account').set(h).send({ type: 'customer', orgId: 10 }),
      request(app).put('/api/admin/users/7/account').set(h).send({ type: 'customer', orgId: 11 }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(mem).toHaveLength(1);
    expect(mem[0]).toBe(store.getUserCustomerOrg(7));
  });

  it('membership failure message says roles and permissions were updated and retry is safe', async () => {
    db.failOn = MEMB;
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(res.body.message).toMatch(/roles and permissions.*already updated.*retry/i);
  });

  it('setUserCustomer failure after the sync says openBalena was updated but the link was not saved', async () => {
    vi.spyOn(store, 'setUserCustomer').mockImplementation(() => {
      throw new Error('disk full');
    });
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/disk full.*openBalena was updated.*admin UI link was not saved.*retry/i);
  });

  it('GET account for internal and customer', async () => {
    const h = await as(1);
    expect((await request(app).get('/api/admin/users/1/account').set(h)).body).toEqual({ type: 'internal', permissionSetId: adminSetId });
    expect((await request(app).get('/api/admin/users/8/account').set(h)).body).toEqual({ type: 'internal', permissionSetId: null });
    store.setUserCustomer(7, 10);
    expect((await request(app).get('/api/admin/users/7/account').set(h)).body).toEqual({ type: 'customer', orgId: 10, effectivePermissionSetId: custSetId });
  });

  it('customer save syncs membership and role with the admin token, then stores', async () => {
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'customer', orgId: 10, effectivePermissionSetId: custSetId });
    const token = `Bearer ${await sign(1)}`;
    expect(pg().every((c) => c.auth === token)).toBe(true);
    expect(pg().map((c) => `${c.method} ${c.url.replace(PG, '')}`)).toEqual([
      'GET /role?name=eq.default-user&select=id',
      'GET /user-has-role?user=eq.7&select=id,role',
      'POST /user-has-role',
      'DELETE /user-has-role?id=eq.200',
      'GET /user-has-permission?user=eq.7&select=id',
      'DELETE /user-has-permission?id=eq.300',
      `GET /organization%20membership?user=eq.7&${SEL_M}`,
      'DELETE /organization%20membership?id=eq.100',
      'POST /organization%20membership',
    ]);
    expect(pg()[8].body).toEqual({ user: 7, 'is member of-organization': 10 });
    expect(pg()[2].body).toEqual({ user: 7, role: 3 });
    expect(store.getUserCustomerOrg(7)).toBe(10);
    expect(store.getUserSet(7)?.id).toBe(custSetId);
  });

  it('already-correct membership and role cause no writes', async () => {
    db.memberships = [{ id: 100, org: 10 }];
    db.roles = [{ id: 200, role: 3 }];
    db.perms = [];
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(res.status).toBe(200);
    expect(pg().filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('removes the explicit set', async () => {
    store.assignUser(7, store.createSet({ name: 'In', capabilities: ['device.read'] }).id);
    await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(store.listAssignments().filter((a) => a.userId === 7)).toEqual([{ userId: 7, type: 'customer', permissionSetId: custSetId, orgId: 10 }]);
  });

  it('400 when the org has no customer permission set', async () => {
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 55 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Org has no customer permission set');
    expect(pg()).toEqual([]);
  });

  it('400 on a bad body', async () => {
    const h = await as(1);
    expect((await request(app).put('/api/admin/users/7/account').set(h).send({ type: 'x' })).status).toBe(400);
    expect((await request(app).put('/api/admin/users/7/account').set(h).send({ type: 'customer' })).status).toBe(400);
    expect((await request(app).put('/api/admin/users/7/account').set(h).send({ type: 'internal', permissionSetId: 'a' })).status).toBe(400);
  });

  it('502 naming step 2 on membership failure, SQLite unchanged', async () => {
    db.failOn = MEMB;
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('organization membership');
    expect(store.getUserCustomerOrg(7)).toBeUndefined();
  });

  it('502 naming the role step on role failure; no permission or membership calls, SQLite unchanged', async () => {
    db.failOn = ROLES;
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('user-has-role');
    expect(pg().filter((c) => c.url.startsWith(MEMB) || c.url.startsWith(PERMS))).toEqual([]);
    expect(store.getUserCustomerOrg(7)).toBeUndefined();
  });

  it('502 naming the permission step on failure; no membership calls, SQLite unchanged', async () => {
    db.failOn = PERMS;
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('user-has-permission');
    expect(pg().filter((c) => c.url.startsWith(MEMB))).toEqual([]);
    expect(store.getUserCustomerOrg(7)).toBeUndefined();
  });

  it('last admin switching to customer is 409 with no sync calls', async () => {
    store.assignUser(2, null);
    const res = await request(app).put('/api/admin/users/1/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(res.status).toBe(409);
    expect(pg()).toEqual([]);
  });

  it('revokes the remote key when the effective set lacks device.terminal', async () => {
    await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 10 });
    expect(calls.filter((c) => c.method === 'DELETE' && c.url.includes('user-has-public'))).toHaveLength(1);
  });

  it('keeps the key when the org set has device.terminal', async () => {
    const term = store.createSet({ name: 'T', capabilities: ['device.read', 'device.terminal'] });
    store.setOrgSettings(12, { permissionSetId: term.id });
    await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'customer', orgId: 12 });
    expect(calls.filter((c) => c.url.includes('user-has-public'))).toEqual([]);
  });

  it('internal save removes the customer link and touches no openBalena memberships', async () => {
    store.setUserCustomer(7, 10);
    const inSet = store.createSet({ name: 'In', capabilities: ['device.read'] });
    const res = await request(app).put('/api/admin/users/7/account').set(await as(1)).send({ type: 'internal', permissionSetId: inSet.id });
    expect(res.body).toEqual({ type: 'internal', permissionSetId: inSet.id });
    expect(store.getUserCustomerOrg(7)).toBeUndefined();
    expect(pg().filter((c) => c.url.includes('membership') || c.url.includes('user-has-role'))).toEqual([]);
  });

  it('assignments list shows type, effective set and org', async () => {
    store.setUserCustomer(7, 10);
    const res = await request(app).get('/api/admin/permission-assignments').set(await as(1));
    expect(res.body.data).toEqual([
      { userId: 1, type: 'internal', permissionSetId: adminSetId, orgId: null },
      { userId: 2, type: 'internal', permissionSetId: adminSetId, orgId: null },
      { userId: 7, type: 'customer', permissionSetId: custSetId, orgId: 10 },
    ]);
  });

  it('legacy permission-set GET reports the effective set', async () => {
    store.setUserCustomer(7, 10);
    expect((await request(app).get('/api/admin/users/7/permission-set').set(await as(1))).body).toEqual({ userId: 7, permissionSetId: custSetId });
  });
});
