// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app, setup, OWN_UUID, FOREIGN_UUID } from './harness';

describe('customer terminal', () => {
  it('connect info needs device.terminal', async () => {
    const ro = setup(['device.read']);
    expect((await request(app).get(`/api/customer/devices/${OWN_UUID}/connect`).set('Authorization', `Bearer ${await ro.token()}`)).status).toBe(403);
    const { token } = setup(['device.terminal']);
    const res = await request(app).get(`/api/customer/devices/${OWN_UUID}/connect`).set('Authorization', `Bearer ${await token()}`);
    expect(res.body).toEqual({ uuid: OWN_UUID, username: 'kunde', containers: ['core'] });
  });

  it('stores the caller own key only', async () => {
    const { token, calls } = setup(['device.terminal']);
    const h = { Authorization: `Bearer ${await token()}` };
    expect((await request(app).post('/api/customer/ssh-key').set(h).send({ publicKey: 'not a key' })).status).toBe(400);
    const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample open-balena-remote';
    expect((await request(app).post('/api/customer/ssh-key').set(h).send({ publicKey: key, deviceUuid: OWN_UUID, user: 1 })).status).toBe(200);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/v7/user__has__public_key')?.body).toEqual({
      user: 5,
      title: 'open-balena-remote',
      public_key: key,
    });
  });

  it('replaces the existing remote key before posting the new one', async () => {
    const { token, calls } = setup(['device.terminal'], { publicKeys: [{ id: 3 }] });
    const key = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ open-balena-remote';
    expect((await request(app).post('/api/customer/ssh-key').set('Authorization', `Bearer ${await token()}`).send({ publicKey: key, deviceUuid: OWN_UUID })).status).toBe(200);
    const lookup = calls.find((c) => c.method === 'GET' && c.path.startsWith('/v7/user__has__public_key'));
    expect(lookup?.path).toContain('user eq 5');
    const deleteIdx = calls.findIndex((c) => c.method === 'DELETE' && c.path === '/v7/user__has__public_key(3)');
    const postIdx = calls.findIndex((c) => c.method === 'POST' && c.path === '/v7/user__has__public_key');
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(postIdx).toBeGreaterThan(deleteIdx);
  });

  it('uses the caller token, not the service key, for key calls', async () => {
    const { token, calls } = setup(['device.terminal'], { publicKeys: [{ id: 3 }] });
    const auth = `Bearer ${await token()}`;
    const key = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ open-balena-remote';
    expect((await request(app).post('/api/customer/ssh-key').set('Authorization', auth).send({ publicKey: key, deviceUuid: OWN_UUID })).status).toBe(200);
    const keyCalls = calls.filter((c) => c.path.startsWith('/v7/user__has__public_key'));
    expect(keyCalls.map((c) => c.method)).toEqual(['GET', 'DELETE', 'POST']);
    for (const c of keyCalls) expect(c.headers?.Authorization).toBe(auth);
  });

  it('maps a balena 403 on key calls to 403', async () => {
    const { token } = setup(['device.terminal']);
    const inner = global.fetch as any;
    global.fetch = vi.fn(async (url: string, init: any) =>
      String(url).includes('user__has__public_key') ? { ok: false, status: 403, json: async () => ({}) } : inner(url, init)) as any;
    const key = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ open-balena-remote';
    expect((await request(app).post('/api/customer/ssh-key').set('Authorization', `Bearer ${await token()}`).send({ publicKey: key, deviceUuid: OWN_UUID })).status).toBe(403);
  });

  it('rejects multi-line, CR-containing and oversized keys without posting', async () => {
    const { token, calls } = setup(['device.terminal']);
    const h = { Authorization: `Bearer ${await token()}` };
    const bad = [
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample comment\nssh-rsa AAAAB3NzaC1yc2E second',
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample bad\rcomment',
      `ssh-ed25519 ${'A'.repeat(4097 - 12)}`,
    ];
    for (const publicKey of bad) {
      expect((await request(app).post('/api/customer/ssh-key').set(h).send({ publicKey })).status).toBe(400);
    }
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v7/user__has__public_key')).toBe(false);
  });

  it('connect info for a foreign device → 403', async () => {
    const { token } = setup(['device.terminal']);
    const res = await request(app).get(`/api/customer/devices/${FOREIGN_UUID}/connect`).set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(403);
  });
});
