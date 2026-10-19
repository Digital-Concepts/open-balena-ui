// @vitest-environment node
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, setup, OWN_UUID } from './harness';

const auth = async (token: () => Promise<string>) => ({ Authorization: `Bearer ${await token()}` });

describe('customer tags', () => {
  it('lists tags with device.read', async () => {
    const { token } = setup(['device.read']);
    const res = await request(app).get(`/api/customer/devices/${OWN_UUID}/tags`).set(await auth(token));
    expect(res.body).toEqual([{ id: 8, key: 'site', value: 'A' }]);
  });
  it('creating needs device.tags.write and validates input', async () => {
    const ro = setup(['device.read']);
    expect((await request(app).post(`/api/customer/devices/${OWN_UUID}/tags`).set(await auth(ro.token)).send({ key: 'k', value: 'v' })).status).toBe(403);
    const { token, calls } = setup(['device.tags.write']);
    const h = await auth(token);
    expect((await request(app).post(`/api/customer/devices/${OWN_UUID}/tags`).set(h).send({ key: '', value: 'v' })).status).toBe(400);
    expect((await request(app).post(`/api/customer/devices/${OWN_UUID}/tags`).set(h).send({ key: 'k', value: 'v' })).status).toBe(200);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/v7/device_tag')?.body).toEqual({ device: 3, tag_key: 'k', value: 'v' });
  });
  it('editing a tag of another device → 404', async () => {
    const { token } = setup(['device.tags.write']);
    const res = await request(app).patch(`/api/customer/devices/${OWN_UUID}/tags/9`).set(await auth(token)).send({ value: 'x' });
    expect(res.status).toBe(404);
  });
  it('editing a tag needs device.tags.write and sends the new value', async () => {
    const { token, calls } = setup(['device.tags.write']);
    const res = await request(app).patch(`/api/customer/devices/${OWN_UUID}/tags/8`).set(await auth(token)).send({ value: 'x' });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.method === 'PATCH' && c.path === '/v7/device_tag(8)')?.body).toEqual({ value: 'x' });
    const ro = setup(['device.tags.delete']);
    expect((await request(app).patch(`/api/customer/devices/${OWN_UUID}/tags/8`).set(await auth(ro.token)).send({ value: 'x' })).status).toBe(403);
  });
  it('delete needs device.tags.delete', async () => {
    const w = setup(['device.tags.write']);
    expect((await request(app).delete(`/api/customer/devices/${OWN_UUID}/tags/8`).set(await auth(w.token))).status).toBe(403);
    const { token, calls } = setup(['device.tags.delete']);
    expect((await request(app).delete(`/api/customer/devices/${OWN_UUID}/tags/8`).set(await auth(token))).status).toBe(200);
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/v7/device_tag(8)')).toBe(true);
  });
});

describe('customer release pin', () => {
  it('lists releases of the device fleet', async () => {
    const { token, calls } = setup(['device.release.pin']);
    const res = await request(app).get(`/api/customer/devices/${OWN_UUID}/releases`).set(await auth(token));
    expect(res.body[0]).toMatchObject({ id: 60, label: '2.0.0' });
    expect(calls.find((c) => c.path.startsWith('/v7/release?'))!.path).toContain('belongs_to__application eq 10');
  });
  it('pins a release of the own fleet', async () => {
    const { token, calls } = setup(['device.release.pin']);
    const res = await request(app).patch(`/api/customer/devices/${OWN_UUID}/pinned-release`).set(await auth(token)).send({ releaseId: 60 });
    expect(res.status).toBe(200);
    const lookup = calls.find((c) => c.path.startsWith('/v7/release?') && c.path.includes('id eq 60'))!;
    expect(lookup.path).toContain('belongs_to__application eq 10');
    expect(lookup.path).toContain("status eq 'success'");
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/v7/device(3)', body: { is_pinned_on__release: 60 } });
  });
  it('refuses a release from another fleet', async () => {
    const { token, calls } = setup(['device.release.pin']);
    const res = await request(app).patch(`/api/customer/devices/${OWN_UUID}/pinned-release`).set(await auth(token)).send({ releaseId: 61 });
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
  it('unpins with null and rejects garbage', async () => {
    const { token } = setup(['device.release.pin']);
    const h = await auth(token);
    expect((await request(app).patch(`/api/customer/devices/${OWN_UUID}/pinned-release`).set(h).send({ releaseId: null })).status).toBe(200);
    expect((await request(app).patch(`/api/customer/devices/${OWN_UUID}/pinned-release`).set(h).send({ releaseId: '60' })).status).toBe(400);
  });
});
