// @vitest-environment node
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, setup, OWN_UUID, FOREIGN_UUID } from './harness';

describe('customer actions', () => {
  it('reboot needs device.actions', async () => {
    const { token } = setup(['device.read']);
    expect((await request(app).post(`/api/customer/devices/${OWN_UUID}/reboot`).set('Authorization', `Bearer ${await token()}`)).status).toBe(403);
  });

  it('reboots an own device via the supervisor proxy', async () => {
    const { token, calls } = setup(['device.actions']);
    const res = await request(app).post(`/api/customer/devices/${OWN_UUID}/reboot`).set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.path === '/supervisor/v1/reboot')?.body).toEqual({ uuid: OWN_UUID });
  });

  it('refuses a foreign device', async () => {
    const { token, calls } = setup(['device.actions']);
    const res = await request(app).post(`/api/customer/devices/${FOREIGN_UUID}/reboot`).set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.path.startsWith('/supervisor'))).toBe(false);
  });

  it('service command validates command and image id', async () => {
    const { token, calls } = setup(['device.actions']);
    const t = await token();
    expect((await request(app).post(`/api/customer/devices/${OWN_UUID}/services/77/delete`).set('Authorization', `Bearer ${t}`)).status).toBe(400);
    expect((await request(app).post(`/api/customer/devices/${OWN_UUID}/services/x/restart`).set('Authorization', `Bearer ${t}`)).status).toBe(400);
    const ok = await request(app).post(`/api/customer/devices/${OWN_UUID}/services/77/restart`).set('Authorization', `Bearer ${t}`);
    expect(ok.status).toBe(200);
    expect(calls.find((c) => c.path === '/supervisor/v2/applications/10/restart-service')?.body).toEqual({ uuid: OWN_UUID, data: { imageId: 77 } });
  });

  it('logs need device.logs and are allowlisted', async () => {
    const denied = setup(['device.read']);
    expect((await request(app).get(`/api/customer/devices/${OWN_UUID}/logs`).set('Authorization', `Bearer ${await denied.token()}`)).status).toBe(403);
    const { token } = setup(['device.logs']);
    const res = await request(app).get(`/api/customer/devices/${OWN_UUID}/logs`).set('Authorization', `Bearer ${await token()}`);
    expect(res.body).toEqual([{ message: 'hello', timestamp: 1, serviceId: 2, isStderr: false, isSystem: false }]);
  });
});
