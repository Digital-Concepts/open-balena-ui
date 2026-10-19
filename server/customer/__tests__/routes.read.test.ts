// @vitest-environment node
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { SignJWT } from 'jose';
import { app, setup, SECRET, OWN_UUID, FOREIGN_UUID } from './harness';

const DEVICE_KEYS = [
  'id', 'uuid', 'device name', 'belongs to-application', 'is of-device type', 'api heartbeat state', 'is online',
  'is connected to vpn', 'last vpn event', 'last connectivity event', 'ip address', 'mac address', 'note', 'status',
  'os version', 'os variant', 'supervisor version', 'is running-release', 'should be running-release', 'is pinned on-release',
  'cpu usage', 'cpu temp', 'memory usage', 'memory total', 'storage usage', 'storage total', 'created at',
].sort();

describe('customer read routes', () => {
  it('lists fleets in scope', async () => {
    const { token, calls } = setup(['device.read']);
    const res = await request(app).get('/api/customer/fleets').set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 10, 'app name': 'fleet-10', slug: 'org/fleet-10', organization: 1, 'should be running-release': 60, 'should track latest release': true },
    ]);
    expect(res.body.total).toBe(1);
    expect(calls.some((c) => c.path.startsWith('/v7/application?') && c.path.includes('id eq 10'))).toBe(true);
  });

  it('lists devices with allowlisted fields only', async () => {
    const { token } = setup(['device.read']);
    const res = await request(app).get('/api/customer/devices').set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(DEVICE_KEYS);
    expect(res.body.data[0]).toMatchObject({
      id: 3,
      'device name': 'dev-3',
      'belongs to-application': 10,
      'is of-device type': 7,
      'is running-release': 50,
      'should be running-release': null,
      'is pinned on-release': null,
      'is online': true,
    });
  });

  it('escapes search text', async () => {
    const { token, calls } = setup(['device.read']);
    await request(app).get('/api/customer/devices').query({ q: "a' or 1 eq 1" }).set('Authorization', `Bearer ${await token()}`);
    const list = calls.find((c) => c.path.startsWith('/v7/device?'))!;
    for (const f of ['device_name', 'note', 'ip_address', 'status']) {
      expect(list.path).toContain(`contains(tolower(${f}),tolower('a'' or 1 eq 1'))`);
    }
    expect(list.path).toContain(' or contains(tolower(note)');
    expect(list.path).toContain('belongs_to__application eq 10');
  });

  it('403 for a fleetId outside scope', async () => {
    const { token, calls } = setup(['device.read']);
    const res = await request(app).get('/api/customer/devices?fleetId=99').set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.path.startsWith('/v7/device?'))).toBe(false);
  });

  it('unknown sort key falls back to device_name', async () => {
    const { token, calls } = setup(['device.read']);
    const res = await request(app).get('/api/customer/devices').query({ sort: 'constructor' }).set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    const list = calls.find((c) => c.path.startsWith('/v7/device?'))!;
    expect(list.path).toContain('$orderby=device_name asc');
  });

  it('zero org memberships: devices and fleets filter to nothing', async () => {
    const { token, calls } = setup(['device.read'], { memberships: [] });
    const t = await token();
    const devices = await request(app).get('/api/customer/devices').set('Authorization', `Bearer ${t}`);
    expect(devices.status).toBe(200);
    expect(devices.body).toEqual({ data: expect.any(Array), total: expect.any(Number) });
    expect(calls.some((c) => c.path.startsWith('/v7/device?') && c.path.includes('belongs_to__application eq -1'))).toBe(true);
    const fleets = await request(app).get('/api/customer/fleets').set('Authorization', `Bearer ${t}`);
    expect(fleets.status).toBe(200);
    expect(calls.some((c) => c.path.startsWith('/v7/application?') && c.path.includes('id eq -1'))).toBe(true);
  });

  it('sorts by admin field names', async () => {
    const { token, calls } = setup(['device.read']);
    const t = await token();
    for (const [sort, field] of [['device name', 'device_name'], ['last connectivity event', 'last_connectivity_event'], ['api heartbeat state', 'api_heartbeat_state'], ['id', 'id']]) {
      await request(app).get('/api/customer/devices').query({ sort, order: 'DESC' }).set('Authorization', `Bearer ${t}`);
      expect(calls.filter((c) => c.path.startsWith('/v7/device?')).pop()!.path).toContain(`$orderby=${field} desc`);
    }
  });

  it('pinned release is exposed under both admin names', async () => {
    const { token } = setup(['device.read']);
    const orig = global.fetch as any;
    global.fetch = (async (url: string, init: any) => {
      const r = await orig(url, init);
      if (!String(url).includes('/v7/device?')) return r;
      const d = (await r.json()).d.map((x: any) => ({ ...x, is_pinned_on__release: { __id: 60 } }));
      return { ok: true, status: 200, json: async () => ({ d }) };
    }) as any;
    const res = await request(app).get('/api/customer/devices').set('Authorization', `Bearer ${await token()}`);
    expect(res.body.data[0]['should be running-release']).toBe(60);
    expect(res.body.data[0]['is pinned on-release']).toBe(60);
  });

  it('device detail by numeric id: own 200 with admin shape, foreign 403, invalid 403', async () => {
    const { token } = setup(['device.read']);
    const t = await token();
    const own = await request(app).get('/api/customer/devices/3').set('Authorization', `Bearer ${t}`);
    expect(own.status).toBe(200);
    expect(Object.keys(own.body).sort()).toEqual(DEVICE_KEYS);
    expect((await request(app).get('/api/customer/devices/4').set('Authorization', `Bearer ${t}`)).status).toBe(403);
    expect((await request(app).get('/api/customer/devices/0').set('Authorization', `Bearer ${t}`)).status).toBe(403);
    expect((await request(app).get('/api/customer/devices/3x').set('Authorization', `Bearer ${t}`)).status).toBe(403);
  });

  it('filters the device list by ids within scope and rejects bad ids', async () => {
    const { token, calls } = setup(['device.read']);
    const t = await token();
    const ok = await request(app).get('/api/customer/devices?ids=3,4,3').set('Authorization', `Bearer ${t}`);
    expect(ok.status).toBe(200);
    const q = calls.find((c) => c.path.startsWith('/v7/device?'))!.path;
    expect(q).toContain('(id eq 3 or id eq 4)');
    expect(q).toContain('belongs_to__application');
    for (const bad of ['x', '1,,2', '0', '1,a', '']) {
      expect((await request(app).get(`/api/customer/devices?ids=${bad}`).set('Authorization', `Bearer ${t}`)).status).toBe(400);
    }
    const many = Array.from({ length: 101 }, (_, i) => i + 1).join(',');
    expect((await request(app).get(`/api/customer/devices?ids=${many}`).set('Authorization', `Bearer ${t}`)).status).toBe(400);
  });

  it('drops foreign-fleet devices returned for ids', async () => {
    const { token } = setup(['device.read']);
    const orig = global.fetch as any;
    global.fetch = (async (url: string, init: any) => {
      const r = await orig(url, init);
      if (!String(url).includes('/v7/device?')) return r;
      const own = (await r.json()).d[0];
      return { ok: true, status: 200, json: async () => ({ d: [own, { ...own, id: 4, belongs_to__application: { __id: 99 } }] }) };
    }) as any;
    const res = await request(app).get('/api/customer/devices?ids=3,4').set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: any) => d.id)).toEqual([3]);
  });

  it('validates ids before resolving scope', async () => {
    const { token, calls } = setup(['device.read']);
    const res = await request(app).get('/api/customer/devices?ids=x').set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.path.startsWith('/v7/organization_membership'))).toBe(false);
  });

  it('device detail needs device.read', async () => {
    setup(['device.read']);
    const noSet = await new SignJWT({ id: 6 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    expect((await request(app).get('/api/customer/devices/3').set('Authorization', `Bearer ${noSet}`)).status).toBe(403);
  });

  it('services of an own device', async () => {
    const { token } = setup(['device.read']);
    const res = await request(app).get(`/api/customer/devices/${OWN_UUID}/services`).set('Authorization', `Bearer ${await token()}`);
    expect(res.body).toEqual([{ imageId: 77, serviceId: 2, serviceName: 'core', releaseId: 50, status: 'Running' }]);
  });

  it('503 when the service key is missing', async () => {
    const { token } = setup(['device.read']);
    delete process.env.OPEN_BALENA_SERVICE_API_KEY;
    const res = await request(app).get('/api/customer/fleets').set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(503);
  });
});
