// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
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
  uniqueFileNames: vi.fn(),
}));
vi.mock('../../lib/deviceShell', async (importOriginal) => {
  const actual: any = await importOriginal();
  // Sessions live outside the shared session root so parallel test files do not see each other's.
  const createSession = () => {
    const dir = fs.mkdtempSync('/tmp/customer-test-session-');
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  };
  return { ...actual, ...sh, createSession, uniqueFileNames: sh.uniqueFileNames.mockImplementation(actual.uniqueFileNames) };
});

// Rate limiting would slow this many requests; it is not under test here.
vi.mock('../../middleware/dosProtect', () => ({ default: [] }));

import { app as baseApp, setup, OWN_UUID, FOREIGN_UUID } from './harness';
import express from 'express';
import { HttpError } from '../../lib/httpError';
import deviceActions from '../deviceActions';

const app = express();
app.use(express.json());
app.use('/', baseApp);
app.use('/', deviceActions);

const url = (uuid: string, p: string) => `/api/customer/devices/${uuid}/${p}`;
const allCalls = () => Object.values(sh).filter((m) => m !== sh.uniqueFileNames).flatMap((m) => m.mock.calls);

function fakeTar() {
  const child: any = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = vi.fn();
  return child;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  Object.values(sh).forEach((m) => m.mockClear());
});

const ROUTES: [string, string, string][] = [
  ['ssh', 'device.ssh', 'ssh'],
  ['log-level', 'device.loglevel', 'log-level'],
  ['files', 'device.files', 'files'],
  ['files/download', 'device.files', 'files/download'],
  ['logs/download', 'device.logs.download', 'logs/download'],
];

describe('customer device actions: authorization', () => {
  it.each(ROUTES)('%s needs %s', async (route) => {
    const { token } = setup(['device.read']);
    const res = await request(app).post(url(OWN_UUID, route)).set('Authorization', `Bearer ${await token()}`).send({ state: 'on', logLevels: 'info' });
    expect(res.status).toBe(403);
    expect(allCalls()).toEqual([]);
  });

  it.each(ROUTES)('%s refuses a foreign device', async (route, cap) => {
    const { token } = setup([cap]);
    const res = await request(app).post(url(FOREIGN_UUID, route)).set('Authorization', `Bearer ${await token()}`).send({ state: 'on', logLevels: 'info' });
    expect(res.status).toBe(403);
    expect(allCalls()).toEqual([]);
  });
});

describe('ssh and log-level', () => {
  it('ignores a body password and uses the device name', async () => {
    const { token } = setup(['device.ssh']);
    const res = await request(app)
      .post(url(OWN_UUID, 'ssh'))
      .set('Authorization', `Bearer ${await token()}`)
      .send({ state: 'on', configPassword: 'evil', password: 'evil', uuid: 'x' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(sh.setSshState).toHaveBeenCalledWith(OWN_UUID, 'dev-3', 'on', expect.any(String));
  });

  it.each([['$(id)'], ['maybe'], [undefined], [1], ['on; id']])('rejects state %j', async (state) => {
    const { token } = setup(['device.ssh']);
    const res = await request(app).post(url(OWN_UUID, 'ssh')).set('Authorization', `Bearer ${await token()}`).send({ state });
    expect(res.status).toBe(400);
    expect(sh.setSshState).not.toHaveBeenCalled();
    expect(sh.balenaLogin).not.toHaveBeenCalled();
  });

  it('accepts info/debug and sends the device name as password', async () => {
    const { token } = setup(['device.loglevel']);
    for (const level of ['info', 'debug']) {
      const res = await request(app).post(url(OWN_UUID, 'log-level')).set('Authorization', `Bearer ${await token()}`).send({ logLevels: level, password: 'evil' });
      expect(res.status).toBe(200);
      expect(sh.setLogLevel).toHaveBeenLastCalledWith(OWN_UUID, 'dev-3', level, expect.any(String));
    }
  });

  it.each([[{ a: 1 }], ['trace'], ['info; id'], [['info']], [undefined], [null]])('rejects logLevels %j', async (logLevels) => {
    const { token } = setup(['device.loglevel']);
    const res = await request(app).post(url(OWN_UUID, 'log-level')).set('Authorization', `Bearer ${await token()}`).send({ logLevels });
    expect(res.status).toBe(400);
    expect(sh.setLogLevel).not.toHaveBeenCalled();
  });

  it('returns a generic error when the gateway call fails', async () => {
    sh.setSshState.mockRejectedValueOnce(new Error('secret detail'));
    const { token } = setup(['device.ssh']);
    const res = await request(app).post(url(OWN_UUID, 'ssh')).set('Authorization', `Bearer ${await token()}`).send({ state: 'off' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('file upload', () => {
  const states = () => sh.setSshState.mock.calls.map((c) => c[2]);

  it('uploads under sanitized names, SSH on then off', async () => {
    const { token } = setup(['device.files']);
    const res = await request(app)
      .post(url(OWN_UUID, 'files'))
      .set('Authorization', `Bearer ${await token()}`)
      .field('uuid', 'evil')
      .field('configPassword', 'evil')
      .attach('files', Buffer.from('x'), 'a b;$(id).txt');
    expect(res.status).toBe(200);
    expect(sh.scpUpload).toHaveBeenCalledWith(20123, expect.any(String), 'a_b___id_.txt');
    expect(states()).toEqual(['on', 'off']);
    expect(sh.setSshState.mock.calls.every((c) => c[0] === OWN_UUID && c[1] === 'dev-3')).toBe(true);
  });

  it('rejects any invalid name before any call', async () => {
    sh.uniqueFileNames.mockImplementationOnce(() => {
      throw new HttpError(400, 'Invalid file name');
    });
    const { token } = setup(['device.files']);
    const res = await request(app)
      .post(url(OWN_UUID, 'files'))
      .set('Authorization', `Bearer ${await token()}`)
      .attach('files', Buffer.from('x'), 'ok.txt')
      .attach('files', Buffer.from('x'), 'two.txt');
    expect(res.status).toBe(400);
    expect(allCalls()).toEqual([]);
  });

  it('turns SSH off after a failed transfer', async () => {
    sh.scpUpload.mockRejectedValueOnce(new Error('boom'));
    const { token } = setup(['device.files']);
    const res = await request(app).post(url(OWN_UUID, 'files')).set('Authorization', `Bearer ${await token()}`).attach('files', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'An error occurred while transferring files' });
    await vi.waitFor(() => expect(states()).toEqual(['on', 'off']));
  });

  it('turns SSH off when enabling it fails after the gateway applied it', async () => {
    sh.setSshState.mockRejectedValueOnce(new Error('timeout'));
    const { token } = setup(['device.files']);
    const res = await request(app).post(url(OWN_UUID, 'files')).set('Authorization', `Bearer ${await token()}`).attach('files', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(500);
    await vi.waitFor(() => expect(states()).toEqual(['on', 'off']));
  });

  it('rejects more than 20 files', async () => {
    const { token } = setup(['device.files']);
    let req = request(app).post(url(OWN_UUID, 'files')).set('Authorization', `Bearer ${await token()}`);
    for (let i = 0; i < 21; i++) req = req.attach('files', Buffer.from('x'), `f${i}.txt`);
    const res = await req;
    expect(res.status).toBe(400);
    expect(allCalls()).toEqual([]);
  });
});

describe('downloads', () => {
  it('streams the outbound zip named like the UI download', async () => {
    const { token } = setup(['device.files']);
    const res = await request(app).post(url(OWN_UUID, 'files/download')).set('Authorization', `Bearer ${await token()}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="outbound_dev.zip"');
    expect(res.body.toString()).toBe('ZIPDATA');
    expect(sh.scpDownloadDir).toHaveBeenCalledWith(20123, expect.any(String), 'outbound');
    await vi.waitFor(() => expect(sh.setSshState.mock.calls.map((c) => c[2])).toEqual(['on', 'off']));
  });

  it('streams the log archive and switches SSH off afterwards', async () => {
    const child = fakeTar();
    sh.sshTarStream.mockReturnValueOnce(child);
    const { token } = setup(['device.logs.download']);
    const pending = request(app).post(url(OWN_UUID, 'logs/download')).set('Authorization', `Bearer ${await token()}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const resP = pending.then((r) => r);
    await vi.waitFor(() => expect(sh.sshTarStream).toHaveBeenCalled());
    child.stdout.end('TARDATA');
    child.emit('close', 0);
    const res = await resP;
    expect(res.headers['content-disposition']).toBe('attachment; filename="logs_dev.tar.gz"');
    expect(res.body.toString()).toBe('TARDATA');
    await vi.waitFor(() => expect(sh.setSshState.mock.calls.map((c) => c[2])).toEqual(['on', 'off']));
  });

  it('turns SSH off when the log archive cannot start', async () => {
    sh.sshTarStream.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    const { token } = setup(['device.logs.download']);
    const res = await request(app).post(url(OWN_UUID, 'logs/download')).set('Authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'An error occurred while downloading logs' });
    await vi.waitFor(() => expect(sh.setSshState.mock.calls.map((c) => c[2])).toEqual(['on', 'off']));
  });
});

describe('concurrency, empty uploads, log archive failures', () => {
  // Late 'off' calls of the previous test can land after mockClear, so compare the tail.
  const states = () => sh.setSshState.mock.calls.map((c) => c[2]).slice(-2);
  const bearer = async (caps: string[]) => `Bearer ${await setup(caps).token()}`;

  it('answers 429 for a second job on the same device and frees the slot after success', async () => {
    let release: () => void = () => {};
    sh.setSshState.mockImplementationOnce(() => new Promise((r) => (release = () => r({}))));
    const auth = await bearer(['device.ssh']);
    const first = request(app).post(url(OWN_UUID, 'ssh')).set('Authorization', auth).send({ state: 'on' }).then((r) => r);
    await vi.waitFor(() => expect(sh.setSshState).toHaveBeenCalledTimes(1));
    sh.balenaLogin.mockClear();
    const second = await request(app).post(url(OWN_UUID, 'ssh')).set('Authorization', auth).send({ state: 'on' });
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ error: 'Device busy, try again shortly' });
    expect(sh.balenaLogin).not.toHaveBeenCalled();
    release();
    expect((await first).status).toBe(200);
    await vi.waitFor(async () => {
      const res = await request(app).post(url(OWN_UUID, 'ssh')).set('Authorization', auth).send({ state: 'off' });
      expect(res.status).toBe(200);
    });
  });

  it('frees the slot after a failed job', async () => {
    sh.setSshState.mockRejectedValueOnce(new Error('boom'));
    const auth = await bearer(['device.ssh']);
    const failed = await request(app).post(url(OWN_UUID, 'ssh')).set('Authorization', auth).send({ state: 'on' });
    expect(failed.status).toBe(500);
    await vi.waitFor(async () => {
      const res = await request(app).post(url(OWN_UUID, 'ssh')).set('Authorization', auth).send({ state: 'on' });
      expect(res.status).toBe(200);
    });
  });

  it('answers 429 to a second upload before parsing the body', async () => {
    let release: () => void = () => {};
    sh.setSshState.mockImplementationOnce(() => new Promise((r) => (release = () => r({}))));
    const auth = await bearer(['device.files']);
    fs.mkdirSync('/tmp/uploads', { recursive: true });
    const first = request(app).post(url(OWN_UUID, 'files')).set('Authorization', auth).attach('files', Buffer.from('x'), 'a.txt').then((r) => r);
    await vi.waitFor(() => expect(sh.setSshState).toHaveBeenCalledTimes(1));
    const uploadsBefore = fs.readdirSync('/tmp/uploads');
    const second = await request(app).post(url(OWN_UUID, 'files')).set('Authorization', auth).attach('files', Buffer.from('x'), 'b.txt');
    expect(second.status).toBe(429);
    expect(fs.readdirSync('/tmp/uploads')).toEqual(uploadsBefore);
    release();
    expect((await first).status).toBe(200);
  });

  it('rejects an empty upload with 400 before any call and frees the slot', async () => {
    const auth = await bearer(['device.files']);
    const res = await request(app).post(url(OWN_UUID, 'files')).set('Authorization', auth).field('note', 'x');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No files' });
    expect(allCalls()).toEqual([]);
    await vi.waitFor(async () => {
      const ok = await request(app).post(url(OWN_UUID, 'files')).set('Authorization', auth).attach('files', Buffer.from('x'), 'a.txt');
      expect(ok.status).toBe(200);
    });
    expect(states()).toEqual(['on', 'off']);
  });

  it('rejects too many form fields with 400', async () => {
    const auth = await bearer(['device.files']);
    let req = request(app).post(url(OWN_UUID, 'files')).set('Authorization', auth);
    for (let i = 0; i < 6; i++) req = req.field(`f${i}`, 'x');
    const res = await req.attach('files', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(400);
    expect(allCalls()).toEqual([]);
  });

  it('names downloads after the first dash segment, falling back to the uuid prefix', async () => {
    const auth = await bearer(['device.files']);
    const res = await request(app).post(url(OWN_UUID, 'files/download')).set('Authorization', auth);
    expect(res.headers['content-disposition']).toBe('attachment; filename="outbound_dev.zip"');
  });

  it('returns 502 when the log archive process exits non-zero before any data', async () => {
    const child = fakeTar();
    sh.sshTarStream.mockReturnValueOnce(child);
    const auth = await bearer(['device.logs.download']);
    const pending = request(app).post(url(OWN_UUID, 'logs/download')).set('Authorization', auth).then((r) => r);
    await vi.waitFor(() => expect(sh.sshTarStream).toHaveBeenCalled());
    child.stderr.write('Permission denied');
    child.stdout.end();
    child.emit('close', 255);
    const res = await pending;
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Log archive failed' });
    expect(res.headers['content-disposition']).toBeUndefined();
    await vi.waitFor(() => expect(states()).toEqual(['on', 'off']));
  });

  it('returns 502 when the log archive process cannot start', async () => {
    const child = fakeTar();
    sh.sshTarStream.mockReturnValueOnce(child);
    const auth = await bearer(['device.logs.download']);
    const pending = request(app).post(url(OWN_UUID, 'logs/download')).set('Authorization', auth).then((r) => r);
    await vi.waitFor(() => expect(sh.sshTarStream).toHaveBeenCalled());
    child.emit('error', new Error('spawn ssh ENOENT'));
    const res = await pending;
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Log archive failed' });
    await vi.waitFor(() => expect(states()).toEqual(['on', 'off']));
  });
});
