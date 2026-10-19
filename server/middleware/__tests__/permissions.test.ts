// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, setStore, PermissionStore } from '../../permissions/store';
import meRoutes from '../../routes/me';
import { requireCapability } from '../permissions';

const SECRET = 'test-secret';
const sign = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

let store: PermissionStore;
const app = express();
app.use(meRoutes);
app.get('/needs-logs', ...requireCapability('device.logs'), (_req, res) => res.json({ ok: true }));

beforeEach(() => {
  process.env.OPEN_BALENA_JWT_SECRET = SECRET;
  store = openStore(':memory:');
  setStore(store);
});

describe('/api/me and capability guard', () => {
  it('401 without token', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
  });
  it('401 for a token without numeric id', async () => {
    const token = await sign({ username: 'x' });
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });
  it('403 when no set is assigned', async () => {
    const token = await sign({ id: 5 });
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('No permission set assigned');
  });
  it('returns the set and capabilities', async () => {
    const s = store.createSet({ name: 'C', capabilities: ['device.logs'] });
    store.assignUser(5, s.id);
    const token = await sign({ id: 5 });
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 5, permissionSet: { id: s.id, name: 'C' }, capabilities: ['device.read', 'device.logs'] });
  });
  it('requireCapability enforces flags and lets admin through', async () => {
    const c = store.createSet({ name: 'C', capabilities: ['device.read'] });
    const a = store.createSet({ name: 'A', capabilities: ['admin'] });
    store.assignUser(5, c.id);
    store.assignUser(6, a.id);
    expect((await request(app).get('/needs-logs').set('Authorization', `Bearer ${await sign({ id: 5 })}`)).status).toBe(403);
    expect((await request(app).get('/needs-logs').set('Authorization', `Bearer ${await sign({ id: 6 })}`)).status).toBe(200);
  });
  it('/api/me returns the org-derived set for a customer user', async () => {
    const s = store.createSet({ name: 'Org', capabilities: ['device.logs'] });
    store.setOrgSettings(10, { permissionSetId: s.id });
    store.setUserCustomer(5, 10);
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${await sign({ id: 5 })}`);
    expect(res.status).toBe(200);
    expect(res.body.permissionSet).toEqual({ id: s.id, name: 'Org' });
    expect(res.body.capabilities).toEqual(['device.read', 'device.logs']);
  });
  it('403 for a customer whose org lost its customer flag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'perm-'));
    const path = join(dir, 'a.db');
    const file = openStore(path);
    const fs2 = file.createSet({ name: 'Org', capabilities: ['device.logs'] });
    file.setOrgSettings(10, { permissionSetId: fs2.id });
    file.setUserCustomer(5, 10);
    setStore(file);
    const raw = new DatabaseSync(path);
    raw.exec('UPDATE org_settings SET permission_set_id = NULL');
    raw.close();
    const status = (await request(app).get('/api/me').set('Authorization', `Bearer ${await sign({ id: 5 })}`)).status;
    rmSync(dir, { recursive: true });
    expect(status).toBe(403);
  });
});
