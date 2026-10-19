// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';

const sh = vi.hoisted(() => ({
  balenaLogin: vi.fn(async () => {}),
  openTunnel: vi.fn(async () => ({ tunnelProcess: { kill: vi.fn() }, tunnelPort: 20123 })),
  setSshState: vi.fn(async (..._a: string[]) => ({})),
  setLogLevel: vi.fn(async () => ({})),
  scpUpload: vi.fn(async () => {}),
  scpDownloadDir: vi.fn(async () => {}),
  zipDir: vi.fn(async (_src: string, zip: string) => fs.writeFileSync(zip, 'ZIPDATA')),
  sshTarStream: vi.fn(),
}));
vi.mock('../../lib/deviceShell', async (importOriginal) => {
  const actual: any = await importOriginal();
  const createSession = () => {
    const dir = fs.mkdtempSync('/tmp/audit-test-session-');
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  };
  // Own upload dir so parallel test files that inspect the shared one are not disturbed.
  return { ...actual, ...sh, createSession, UPLOAD_ROOT: fs.mkdtempSync('/tmp/audit-test-uploads-') };
});
vi.mock('../../middleware/dosProtect', () => ({ default: [] }));

import express from 'express';
import { app as baseApp, setup, OWN_UUID, FOREIGN_UUID } from '../../customer/__tests__/harness';
import deviceActions from '../../customer/deviceActions';
import { getStore } from '../../permissions/store';
import { audited, clearAuditCache } from '../record';

const app = express();
app.use(express.json());
app.use('/', baseApp);
app.use('/', deviceActions);

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample open-balena-remote';
const dev = (p: string) => `/api/customer/devices/${OWN_UUID}/${p}`;
const entries = () => getStore().listAudit({ page: 1, perPage: 50 }).data;
const settle = () => new Promise((r) => setTimeout(r, 30));

function fakeTar() {
  const child: any = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = vi.fn(() => {
    child.stdout.end();
    child.emit('close', null);
  });
  return child;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  Object.values(sh).forEach((m) => m.mockClear());
  clearAuditCache();
});

async function as(caps: string[]) {
  const { token, calls } = setup(caps);
  return { h: { Authorization: `Bearer ${await token()}` }, calls };
}

type Case = [action: string, cap: string, send: (h: Record<string, string>) => Promise<request.Response>, details: unknown];

const CASES: Case[] = [
  ['device.reboot', 'device.actions', (h) => request(app).post(dev('reboot')).set(h), null],
  ['service.command', 'device.actions', (h) => request(app).post(dev('services/77/restart')).set(h), { command: 'restart', imageId: 77 }],
  ['tag.create', 'device.tags.write', (h) => request(app).post(dev('tags')).set(h).send({ key: 'k', value: 'secret-value' }), { key: 'k' }],
  ['tag.update', 'device.tags.write', (h) => request(app).patch(dev('tags/8')).set(h).send({ value: 'secret-value' }), { key: 'site' }],
  ['tag.delete', 'device.tags.delete', (h) => request(app).delete(dev('tags/8')).set(h), { key: 'site' }],
  ['release.pin', 'device.release.pin', (h) => request(app).patch(dev('pinned-release')).set(h).send({ releaseId: 60 }), { releaseId: 60, version: '2.0.0' }],
  ['release.pin', 'device.release.pin', (h) => request(app).patch(dev('pinned-release')).set(h).send({ releaseId: null }), { unpinned: true }],
  ['terminal.open', 'device.terminal', (h) => request(app).post('/api/customer/ssh-key').set(h).send({ publicKey: KEY, deviceUuid: OWN_UUID }), null],
  ['ssh.set', 'device.ssh', (h) => request(app).post(dev('ssh')).set(h).send({ state: 'on' }), { state: 'on' }],
  ['loglevel.set', 'device.loglevel', (h) => request(app).post(dev('log-level')).set(h).send({ logLevels: 'debug' }), { logLevels: 'debug' }],
  ['files.upload', 'device.files', (h) => request(app).post(dev('files')).set(h).attach('files', Buffer.from('file-content'), 'a b.txt'), { count: 1, names: ['a_b.txt'] }],
  ['files.download', 'device.files', (h) => request(app).post(dev('files/download')).set(h), null],
];

describe('audit recording', () => {
  it.each(CASES)('%s records one ok entry', async (action, cap, send, details) => {
    const { h } = await as([cap]);
    const res = await send(h);
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({
      userId: 5,
      username: 'kunde',
      fleetId: 10,
      fleetName: 'fleet-10',
      deviceUuid: OWN_UUID,
      deviceName: 'dev-3',
      action,
      details,
      result: 'ok',
      error: null,
    });
    expect(JSON.stringify(entries())).not.toContain('secret-value');
    expect(JSON.stringify(entries())).not.toContain('file-content');
  });

  it('logs.download records ok when the stream completes', async () => {
    const child = fakeTar();
    sh.sshTarStream.mockReturnValueOnce(child);
    const { h } = await as(['device.logs.download']);
    const pending = request(app).post(dev('logs/download')).set(h).then((r) => r);
    await vi.waitFor(() => expect(sh.sshTarStream).toHaveBeenCalled());
    child.stdout.end('TARDATA');
    child.emit('close', 0);
    expect((await pending).status).toBe(200);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ action: 'logs.download', result: 'ok', details: null });
  });

  it('records the customer org of a linked user', async () => {
    const { h } = await as(['device.actions']);
    const store = getStore();
    store.setOrgSettings(1, { permissionSetId: store.getUserSet(5)!.id });
    store.setUserCustomer(5, 1);
    expect((await request(app).post(dev('reboot')).set(h)).status).toBe(200);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ orgId: 1, orgName: 'org-1' });
  });

  it('records internal users without an org', async () => {
    const { h } = await as(['device.actions']);
    expect((await request(app).post(dev('reboot')).set(h)).status).toBe(200);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ orgId: null, orgName: null });
  });

  it('records a failed balena call with its message', async () => {
    const { h } = await as(['device.actions']);
    const inner = global.fetch as any;
    global.fetch = vi.fn(async (url: string, init: any) =>
      String(url).includes('/supervisor/') ? { ok: false, status: 500, json: async () => ({}) } : inner(url, init)) as any;
    expect((await request(app).post(dev('reboot')).set(h)).status).toBe(502);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ action: 'device.reboot', result: 'failed', error: 'balena API responded 500' });
  });

  it('records a failed gateway call with the job error', async () => {
    sh.setSshState.mockRejectedValueOnce(new Error('secret detail'));
    const { h } = await as(['device.ssh']);
    expect((await request(app).post(dev('ssh')).set(h).send({ state: 'off' })).status).toBe(500);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ result: 'failed', error: 'An error occurred while changing SSH status', details: { state: 'off' } });
  });

  it('truncates long errors to 300 characters', async () => {
    setup(['device.read']);
    const unit = express();
    unit.post('/x', (req, _res, next) => ((req.user = { id: 5 }), next()), audited('device.reboot'), (req, res) => {
      req.auditDevice = { uuid: OWN_UUID, name: 'dev-3', fleetId: 10 };
      res.status(400).json({ success: false, message: 'x'.repeat(500) });
    });
    expect((await request(unit).post('/x')).status).toBe(400);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0].error).toBe('x'.repeat(300));
  });

  it('still records with null names when lookups fail', async () => {
    const { h } = await as(['device.actions']);
    const inner = global.fetch as any;
    global.fetch = vi.fn(async (url: string, init: any) =>
      /\/v7\/(user|application|organization)\(/.test(decodeURIComponent(String(url))) ? { ok: false, status: 500, json: async () => ({}) } : inner(url, init)) as any;
    expect((await request(app).post(dev('reboot')).set(h)).status).toBe(200);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ username: null, fleetName: null, result: 'ok' });
  });

  it('caches name lookups', async () => {
    const { h, calls } = await as(['device.actions']);
    for (let i = 0; i < 2; i++) expect((await request(app).post(dev('reboot')).set(h)).status).toBe(200);
    await vi.waitFor(() => expect(entries()).toHaveLength(2));
    expect(calls.filter((c) => c.path.startsWith('/v7/user(')).length).toBe(1);
    expect(calls.filter((c) => c.path.startsWith('/v7/application(')).length).toBe(1);
  });

  it.each(CASES)('%s without capability records nothing', async (_a, _cap, send) => {
    const { h } = await as(['device.read']);
    expect((await send(h)).status).toBe(403);
    await settle();
    expect(entries()).toEqual([]);
  });

  it.each([
    ['reboot', 'device.actions'],
    ['ssh', 'device.ssh'],
    ['files/download', 'device.files'],
  ])('%s on a foreign device records nothing', async (p, cap) => {
    const { h } = await as([cap]);
    const res = await request(app).post(`/api/customer/devices/${FOREIGN_UUID}/${p}`).set(h).send({ state: 'on' });
    expect(res.status).toBe(403);
    await settle();
    expect(entries()).toEqual([]);
  });

  it('validation before the device is loaded records nothing', async () => {
    const { h } = await as(['device.tags.write']);
    expect((await request(app).post(dev('tags')).set(h).send({ key: '', value: 'v' })).status).toBe(400);
    await settle();
    expect(entries()).toEqual([]);
  });

  it('an aborted download is recorded as failed', async () => {
    const child = fakeTar();
    sh.sshTarStream.mockReturnValueOnce(child);
    const { h } = await as(['device.logs.download']);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      await new Promise<void>((resolve) => {
        const req = http.request({ port, method: 'POST', path: dev('logs/download'), headers: h }, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => {});
        req.end();
        void vi.waitFor(() => expect(sh.sshTarStream).toHaveBeenCalled()).then(() => child.stdout.write('PART'));
      });
      await vi.waitFor(() => expect(entries()).toHaveLength(1));
      expect(entries()[0]).toMatchObject({ action: 'logs.download', result: 'failed', error: 'aborted' });
    } finally {
      server.close();
    }
  });

  // Holds the first fetch matching `match` until released; aborts the raw client once it is reached.
  async function abortDuring(match: (path: string) => boolean, route: string, h: Record<string, string>) {
    const inner = global.fetch as any;
    let releaseFetch: () => void = () => {};
    let reached: () => void = () => {};
    const reachedP = new Promise<void>((r) => (reached = r));
    let held = false;
    global.fetch = vi.fn(async (url: string, init: any) => {
      if (!held && match(decodeURIComponent(String(url)))) {
        held = true;
        reached();
        await new Promise<void>((r) => (releaseFetch = r));
      }
      return inner(url, init);
    }) as any;
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const req = http.request({ port, method: 'POST', path: route, headers: h });
    req.on('error', () => {});
    req.end();
    await reachedP;
    req.destroy();
    await new Promise((r) => setTimeout(r, 30));
    releaseFetch();
    await settle();
    server.close();
  }

  it('a client that leaves during the device lookup stops the action', async () => {
    const { h, calls } = await as(['device.actions']);
    await abortDuring((p) => p.includes('/v7/device?'), dev('reboot'), h);
    expect(calls.some((c) => c.path.startsWith('/supervisor/'))).toBe(false);
    expect(entries()).toEqual([]);
  });

  it('a client that leaves after the device loaded records an unknown outcome', async () => {
    const { h, calls } = await as(['device.actions']);
    await abortDuring((p) => p.includes('/supervisor/'), dev('reboot'), h);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(calls.some((c) => c.path.startsWith('/supervisor/'))).toBe(true);
    expect(entries()[0]).toMatchObject({ action: 'device.reboot', result: 'failed', error: 'client disconnected; outcome unknown' });
  });

  it('records the action time, not the insert time', async () => {
    const { h } = await as(['device.actions']);
    const inner = global.fetch as any;
    let releaseLookup: () => void = () => {};
    const lookupHeld = new Promise<void>((r) => (releaseLookup = r));
    global.fetch = vi.fn(async (url: string, init: any) => {
      if (decodeURIComponent(String(url)).includes('/v7/user(')) await lookupHeld;
      return inner(url, init);
    }) as any;
    expect((await request(app).post(dev('reboot')).set(h)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const afterResponse = new Date().toISOString();
    releaseLookup();
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0].ts < afterResponse).toBe(true);
  });

  it('a busy device (429) records nothing', async () => {
    let release: () => void = () => {};
    sh.setSshState.mockImplementationOnce(() => new Promise((r) => (release = () => r({}))));
    const { h } = await as(['device.ssh']);
    const first = request(app).post(dev('ssh')).set(h).send({ state: 'on' }).then((r) => r);
    await vi.waitFor(() => expect(sh.setSshState).toHaveBeenCalledTimes(1));
    const busy = await request(app).post(dev('ssh')).set(h).send({ state: 'on' });
    expect(busy.status).toBe(429);
    await settle();
    expect(entries()).toEqual([]);
    release();
    expect((await first).status).toBe(200);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(entries()[0]).toMatchObject({ action: 'ssh.set', result: 'ok' });
  });

  it('a throwing recordAudit leaves the response unchanged', async () => {
    const { h } = await as(['device.actions']);
    const spy = vi.spyOn(getStore(), 'recordAudit').mockImplementation(() => {
      throw new Error('database is locked');
    });
    const res = await request(app).post(dev('reboot')).set(h);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
  });
});

describe('ssh-key deviceUuid', () => {
  it.each([[undefined], ['not-a-uuid'], [123], ["a' or 1 eq 1"]])('rejects deviceUuid %j with 400', async (deviceUuid) => {
    const { h, calls } = await as(['device.terminal']);
    const res = await request(app).post('/api/customer/ssh-key').set(h).send({ publicKey: KEY, deviceUuid });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('deviceUuid required');
    expect(calls.some((c) => c.path.startsWith('/v7/user__has__public_key'))).toBe(false);
    await settle();
    expect(entries()).toEqual([]);
  });

  it('refuses a foreign device with 403 before touching keys', async () => {
    const { h, calls } = await as(['device.terminal']);
    const res = await request(app).post('/api/customer/ssh-key').set(h).send({ publicKey: KEY, deviceUuid: FOREIGN_UUID });
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.path.startsWith('/v7/user__has__public_key'))).toBe(false);
    await settle();
    expect(entries()).toEqual([]);
  });

  it('never logs the key', async () => {
    const { h } = await as(['device.terminal']);
    expect((await request(app).post('/api/customer/ssh-key').set(h).send({ publicKey: KEY, deviceUuid: OWN_UUID })).status).toBe(200);
    await vi.waitFor(() => expect(entries()).toHaveLength(1));
    expect(JSON.stringify(entries())).not.toContain('AAAAC3');
  });
});
