// @vitest-environment node
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { SignJWT } from 'jose';
import { app, setup, SECRET } from './harness';

const get = async (caps: string[], path: string) => {
  const { token, calls } = setup(caps);
  const res = await request(app).get(path).set('Authorization', `Bearer ${await token()}`);
  return { res, calls };
};

describe('customer lookup', () => {
  it('needs device.read', async () => {
    setup(['device.read']);
    const noSet = await new SignJWT({ id: 6 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    expect((await request(app).get('/api/customer/lookup/application?ids=10').set('Authorization', `Bearer ${noSet}`)).status).toBe(403);
  });

  it('application: in-scope fleets only, mapped fields', async () => {
    const { res, calls } = await get(['device.read'], '/api/customer/lookup/application?ids=10,99');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [{ id: 10, 'app name': 'fleet-10', slug: 'org/fleet-10', organization: 1, 'should be running-release': 60, 'should track latest release': true }],
    });
    const q = calls.find((c) => c.path.startsWith('/v7/application?') && c.path.includes('slug'))!;
    expect(q.path).toContain('id eq 10 or id eq 99');
  });

  it('release: only releases of in-scope fleets', async () => {
    const { res } = await get(['device.read'], '/api/customer/lookup/release?ids=60,61');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual({
      id: 60, commit: 'c0ffee00', 'semver major': 2, 'semver minor': 0, 'semver patch': 0, 'semver prerelease': '',
      'semver build': '', 'semver revision': 0, 'raw version': '2.0.0', status: 'success', 'created at': '2026-10-01',
      'is final': true, 'belongs to-application': 10,
    });
  });

  it('device type: unrestricted, allowlisted fields', async () => {
    const { res } = await get(['device.read'], '/api/customer/lookup/device%20type?ids=7');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 7, slug: 'rpi', name: 'Raspberry Pi' }] });
  });

  it('rejects invalid ids without calling the API', async () => {
    for (const ids of ['', 'x', '1,,2', '0', '-1', '1.5', "1 or 1 eq 1", Array.from({ length: 101 }, (_, i) => i + 1).join(',')]) {
      const { res, calls } = await get(['device.read'], `/api/customer/lookup/application?ids=${encodeURIComponent(ids)}`);
      expect(res.status, ids).toBe(400);
      expect(calls.some((c) => c.path.startsWith('/v7/application?') && c.path.includes('slug'))).toBe(false);
    }
  });

  it('dedupes ids before the limit', async () => {
    const ids = Array.from({ length: 150 }, () => 10).join(',');
    expect((await get(['device.read'], `/api/customer/lookup/application?ids=${ids}`)).res.status).toBe(200);
  });

  it('unknown resource -> 404', async () => {
    expect((await get(['device.read'], '/api/customer/lookup/constructor?ids=1')).res.status).toBe(404);
    expect((await get(['device.read'], '/api/customer/lookup/user?ids=1')).res.status).toBe(404);
  });
});
