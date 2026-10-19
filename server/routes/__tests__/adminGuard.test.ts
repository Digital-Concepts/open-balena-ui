// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { openStore, setStore } from '../../permissions/store';
import registryImageRoutes from '../registryImage';
import housekeeperRoutes from '../housekeeper';
import securityRoutes from '../security';
import serialListRoutes from '../serialList';
import taskDispatcherRoutes from '../taskDispatcher';
import deviceAdminRoutes from '../deviceAdmin';

const SECRET = 'test-secret';
const sign = (id: number) =>
  new SignJWT({ id }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(SECRET));

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/', registryImageRoutes);
app.use('/', housekeeperRoutes);
app.use('/', securityRoutes);
app.use('/', serialListRoutes);
app.use('/', taskDispatcherRoutes);
app.use('/', deviceAdminRoutes);

beforeEach(() => {
  process.env.OPEN_BALENA_JWT_SECRET = SECRET;
  const store = openStore(':memory:');
  const c = store.createSet({ name: 'C', capabilities: ['device.read'] });
  store.assignUser(5, c.id);
  setStore(store);
});

describe('existing routes are admin-only', () => {
  it.each([
    ['get', '/housekeeper/status'],
    ['get', '/security/status'],
    ['get', '/getGateways'],
    ['post', '/task-dispatcher/command'],
    ['post', '/deleteRegistryImage'],
    ['post', '/deleteOrphanedRegistryImages'],
    ['post', '/registerGateway'],
    ['post', '/deleteGateway'],
    ['post', '/download-logs'],
    ['post', '/log-level'],
    ['post', '/control-ssh'],
    ['post', '/send-files'],
    ['post', '/download-files'],
    ['post', '/update-supervisor'],
    ['post', '/download-backup'],
    ['post', '/upload-ionos'],
  ])('%s %s → 403 for a customer', async (method, path) => {
    const token = await sign(5);
    const res = await (request(app) as any)[method](path).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(403);
  });
});

describe('admin access', () => {
  it('an admin token passes the guard on /housekeeper/status', async () => {
    const store = openStore(':memory:');
    store.assignUser(1, store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true }).id);
    setStore(store);
    process.env.HOUSEKEEPER_TOKEN = 'hk';
    global.fetch = vi.fn(async () => ({ status: 200, json: async () => ({}), text: async () => '' })) as any;
    const res = await request(app).get('/housekeeper/status').set('Authorization', `Bearer ${await sign(1)}`);
    expect([401, 403]).not.toContain(res.status);
    expect(res.status).toBe(200);
  });
});
