// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';

const cp = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn(), exec: vi.fn() }));
vi.mock('node:child_process', () => ({ ...cp, default: cp }));
vi.mock('portfinder', () => ({ default: { getPortPromise: vi.fn(async () => 20123) } }));
vi.mock('wait-port', () => ({ default: vi.fn(async () => true) }));
vi.mock('../../lib/deviceShell', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, uniqueFileNames: vi.fn(actual.uniqueFileNames) };
});
vi.mock('njwt', () => ({ default: { verify: vi.fn() } }));
vi.mock('../../middleware', () => ({
  authorize: (_req: any, _res: any, next: any) => next(),
  requireAdmin: [],
  dosProtect: [],
}));

import deviceAdminRoutes from '../deviceAdmin';
import { SESSION_ROOT, uniqueFileNames } from '../../lib/deviceShell';
import { HttpError } from '../../lib/httpError';

const UUID = 'b'.repeat(32);
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.e30.sig';

const app = express();
app.use(express.json());
app.use('/', deviceAdminRoutes);

const nth = (arr: any, i: number): string => arr[arr.length + i];

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4242;
  child.exitCode = null;
  child.kill = vi.fn();
  return child;
}

let tunnels: any[] = [];
let tarChild: any;

function argvOf(file: string) {
  return cp.execFile.mock.calls.filter((c) => c[0] === file).map((c) => c[1] as string[]);
}

function sshStates(): string[] {
  return (global.fetch as any).mock.calls
    .filter((c: any[]) => c[0].endsWith('/system/config/ssh'))
    .map((c: any[]) => JSON.parse(c[1].body).state);
}

function sessionEntries(): string[] {
  return fs.existsSync(SESSION_ROOT) ? fs.readdirSync(SESSION_ROOT) : [];
}

const settle = () => new Promise((r) => setTimeout(r, 30));

let before: string[];
let uploadsBefore: string[];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  cp.execFile.mockReset();
  cp.spawn.mockReset();
  cp.exec.mockReset();
  tunnels = [];
  cp.spawn.mockImplementation((file: string) => {
    const child = fakeChild();
    if (file === 'ssh') tarChild = child;
    else tunnels.push(child);
    return child;
  });
  cp.execFile.mockImplementation((file: string, args: string[], opts: any, cb?: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    if (file === 'zip') fs.writeFileSync(args[1], 'ZIPDATA');
    callback(null, file === 'ssh' ? 'step 1\nall done\n' : '', '');
    return fakeChild();
  });
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ ok: 1 }) })) as any;
  before = sessionEntries();
  fs.mkdirSync('/tmp/uploads', { recursive: true });
  uploadsBefore = fs.readdirSync('/tmp/uploads');
  tarChild = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function expectNoNewSessions() {
  const leftovers = sessionEntries().filter((e) => !before.includes(e));
  expect(leftovers).toEqual([]);
}

const post = (p: string) => request(app).post(p).set('Authorization', `Bearer ${TOKEN}`);

describe('admin device routes reject hostile uuids before any process', () => {
  it.each([
    '/download-logs',
    '/log-level',
    '/control-ssh',
    '/download-files',
    '/update-supervisor',
    '/download-backup',
    '/upload-ionos',
  ])('%s', async (route) => {
    for (const uuid of ['a;rm -rf /', '$(id)', '../../etc', `${UUID}\nid`, undefined]) {
      const res = await post(route).send({ uuid, configPassword: 'pw', password: 'pw', status: 'on' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid device uuid' });
    }
    expect(cp.execFile).not.toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
    expect(cp.exec).not.toHaveBeenCalled();
  });

  it('/send-files', async () => {
    const res = await post('/send-files').field('uuid', '$(id)').attach('files', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(400);
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});

describe('/control-ssh', () => {
  it('logs in with argv and returns the gateway response', async () => {
    const res = await post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'on' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: 1 } });
    expect(argvOf('/usr/bin/balena')[0]).toEqual(['login', '--token', TOKEN, '--unsupported']);
    expect(sshStates()).toEqual(['on']);
    expectNoNewSessions();
  });

  it('passes a gateway error status through', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized' })) as any;
    const res = await post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'off' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Failed to change SSH status: Unauthorized' });
    expectNoNewSessions();
  });

  it('rejects a status other than on/off', async () => {
    const res = await post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'on;reboot' });
    expect(res.status).toBe(400);
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});

describe('/log-level', () => {
  it('posts logLevel with the body password', async () => {
    const res = await post('/log-level').send({ uuid: UUID, password: 'pw', logLevels: { core: 'DEBUG' } });
    expect(res.body).toEqual({ success: true, data: { ok: 1 } });
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toMatch(/\/system\/config\/loglevel$/);
    expect(JSON.parse(init.body)).toEqual({ logLevel: { core: 'DEBUG' } });
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('ConfigUser:pw').toString('base64')}`);
    expect(tunnels[0].kill).toHaveBeenCalled();
    expectNoNewSessions();
  });

  it('passes a gateway failure through with the old message', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, statusText: 'Forbidden' })) as any;
    const res = await post('/log-level').send({ uuid: UUID, password: 'pw', logLevels: {} });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Failed to update log level: Forbidden' });
  });
});

describe('/send-files', () => {
  it('uploads hostile file names only in sanitized form and deletes temp files', async () => {
    const res = await post('/send-files')
      .field('uuid', UUID)
      .field('configPassword', 'pw')
      .attach('files', Buffer.from('one'), { filename: '$(id);rm -rf x`y`.txt' })
      .attach('files', Buffer.from('two'), { filename: '.profile' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Files uploaded successfully' });
    const scps = argvOf('scp');
    expect(scps).toHaveLength(2);
    expect(nth(scps[0], -1)).toBe('root@127.0.0.1:/opt/spaceport/__id__rm_-rf_x_y_.txt');
    expect(nth(scps[1], -1)).toBe('root@127.0.0.1:/opt/spaceport/_profile');
    for (const argv of scps) {
      expect(argv.join(' ')).not.toMatch(/\$\(|`|;/);
      expect(fs.existsSync(nth(argv, -2))).toBe(false);
    }
    expect(cp.exec).not.toHaveBeenCalled();
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expectNoNewSessions();
  });

  it('switches SSH off and deletes temp files when the transfer fails', async () => {
    cp.execFile.mockImplementation((file: string, _a: any, opts: any, cb?: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(file === 'scp' ? new Error('scp failed') : null, '', '');
    });
    const res = await post('/send-files')
      .field('uuid', UUID)
      .field('configPassword', 'pw')
      .attach('files', Buffer.from('one'), 'a.txt')
      .attach('files', Buffer.from('two'), 'b.txt');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'An error occurred while transferring files' });
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expect(fs.existsSync(nth(argvOf('scp')[0], -2))).toBe(false);
    expectNoNewSessions();
  });
});

describe('/send-files names', () => {
  it('de-duplicates colliding sanitized names', async () => {
    const res = await post('/send-files')
      .field('uuid', UUID)
      .field('configPassword', 'pw')
      .attach('files', Buffer.from('1'), 'a b.txt')
      .attach('files', Buffer.from('2'), 'a_b.txt');
    expect(res.status).toBe(200);
    expect(argvOf('scp').map((a) => nth(a, -1))).toEqual([
      'root@127.0.0.1:/opt/spaceport/a_b.txt',
      'root@127.0.0.1:/opt/spaceport/a_b_1.txt',
    ]);
  });

  it('rejects the batch with 400 before any process when a name is invalid', async () => {
    (uniqueFileNames as any).mockImplementationOnce(() => {
      throw new HttpError(400, 'Invalid file name');
    });
    const res = await post('/send-files')
      .field('uuid', UUID)
      .field('configPassword', 'pw')
      .attach('files', Buffer.from('1'), 'ok.txt')
      .attach('files', Buffer.from('2'), 'other.txt');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid file name' });
    expect(cp.execFile).not.toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync('/tmp/uploads').filter((f) => !uploadsBefore.includes(f))).toEqual([]);
  });
});

/** Raw request so the client can disconnect mid-flight. */
function rawPost(route: string, body: object) {
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const req = http.request({
    port,
    method: 'POST',
    path: route,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  });
  req.on('error', () => {});
  const response = new Promise<http.IncomingMessage>((resolve) => req.on('response', resolve));
  req.end(JSON.stringify(body));
  return { server, req, response };
}

describe('client disconnects', () => {
  it('zip download: client leaves during scp → no zip/stream, SSH off, cleanup', async () => {
    let release: () => void = () => {};
    cp.execFile.mockImplementation((file: string, args: string[], opts: any, cb?: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (file === 'scp') release = () => callback(null, '', '');
      else {
        if (file === 'zip') fs.writeFileSync(args[1], 'ZIPDATA');
        callback(null, '', '');
      }
    });
    const readSpy = vi.spyOn(fs, 'createReadStream');
    const { server, req } = rawPost('/download-files', { uuid: UUID, name: 'n', configPassword: 'pw' });
    await vi.waitFor(() => expect(argvOf('scp')).toHaveLength(1));
    req.destroy();
    await settle();
    release();
    await settle();
    expect(cp.execFile.mock.calls.some((c) => c[0] === 'zip')).toBe(false);
    expect(readSpy).not.toHaveBeenCalled();
    expect(sshStates()).toEqual(['on', 'off']);
    expect(tunnels.every((t) => t.kill.mock.calls.length > 0)).toBe(true);
    expectNoNewSessions();
    server.close();
  });

  it('log download: client leaves while SSH is being enabled → no tar, SSH off, cleanup', async () => {
    let release: () => void = () => {};
    global.fetch = vi.fn((url: string, init: any) => {
      const reply = { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
      if (JSON.parse(init.body).state === 'on') return new Promise((r) => (release = () => r(reply)));
      return Promise.resolve(reply);
    }) as any;
    const { server, req } = rawPost('/download-logs', { uuid: UUID, name: 'n', configPassword: 'pw' });
    await vi.waitFor(() => expect(sshStates()).toEqual(['on']));
    req.destroy();
    await settle();
    release();
    await settle();
    expect(cp.spawn.mock.calls.some((c) => c[0] === 'ssh')).toBe(false);
    expect(sshStates()).toEqual(['on', 'off']);
    expectNoNewSessions();
    server.close();
  });

  it('log download: client leaves mid-stream → tar killed, SSH off, cleanup', async () => {
    const { server, req, response } = rawPost('/download-logs', { uuid: UUID, name: 'n', configPassword: 'pw' });
    await vi.waitFor(() => expect(tarChild).toBeDefined());
    tarChild.kill.mockImplementation(() => {
      tarChild.exitCode = 143;
      tarChild.emit('close', 143);
    });
    tarChild.stdout.write('PARTIAL');
    await response;
    req.destroy();
    await vi.waitFor(() => expect(tarChild.kill).toHaveBeenCalled());
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expectNoNewSessions();
    server.close();
  });

  it('zip download: client leaves mid-stream → cleanup', async () => {
    cp.execFile.mockImplementation((file: string, args: string[], opts: any, cb?: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (file === 'zip') fs.writeFileSync(args[1], Buffer.alloc(8 * 1024 * 1024));
      callback(null, '', '');
    });
    const { server, req, response } = rawPost('/download-files', { uuid: UUID, name: 'n', configPassword: 'pw' });
    const res = await response;
    await new Promise((r) => res.once('data', r));
    req.destroy();
    await vi.waitFor(() => expect(sshStates()).toEqual(['on', 'off']));
    await settle();
    expectNoNewSessions();
    server.close();
  });
});

describe('zip downloads', () => {
  it('/download-files streams the outbound zip and cleans up', async () => {
    const res = await post('/download-files').send({ uuid: UUID, name: 'GW-1', configPassword: 'pw' });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="outbound_GW-1.zip"');
    expect(res.headers['content-type']).toBe('application/zip');
    const scp = argvOf('scp')[0];
    expect(nth(scp, -2)).toBe('root@127.0.0.1:/opt/spaceport/outbound/*');
    expect(nth(scp, -1).startsWith(SESSION_ROOT + '/')).toBe(true);
    expect(nth(scp, -1)).not.toContain(UUID);
    const zipCall = cp.execFile.mock.calls.find((c) => c[0] === 'zip')!;
    expect(zipCall[1][2]).toBe('.');
    expect(zipCall[2].cwd).toBe(nth(scp, -1));
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expectNoNewSessions();
  });

  it('/download-backup fetches the backup set', async () => {
    const res = await post('/download-backup').send({ uuid: UUID, name: 'GW-1', configPassword: 'pw' });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="backup_GW-1.zip"');
    expect(nth(argvOf('scp')[0], -2)).toBe('root@127.0.0.1:/backup/backup_*');
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expectNoNewSessions();
  });

  it('/download-files switches SSH off when scp fails', async () => {
    cp.execFile.mockImplementation((file: string, _a: any, opts: any, cb?: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(file === 'scp' ? new Error('no such file') : null, '', '');
    });
    const res = await post('/download-files').send({ uuid: UUID, name: 'GW-1', configPassword: 'pw' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'An error occurred while downloading files' });
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expectNoNewSessions();
  });
});

describe('/download-logs', () => {
  it('streams the remote tar and switches SSH off afterwards', async () => {
    const pending = post('/download-logs').send({ uuid: UUID, name: 'GW-1', configPassword: 'pw' });
    const done = pending.then((r) => r);
    await vi.waitFor(() => expect(tarChild).toBeDefined());
    tarChild.stdout.end('TARBYTES');
    tarChild.exitCode = 0;
    tarChild.emit('close', 0);
    const res = await done;
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="logs_GW-1.tar.gz"');
    const sshCall = cp.spawn.mock.calls.find((c) => c[0] === 'ssh')!;
    expect(nth(sshCall[1], -1)).toBe('tar czf - -C /var/log/dcgw .');
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expectNoNewSessions();
  });
});

describe('fixed ssh commands', () => {
  it('/update-supervisor keeps its response shape', async () => {
    const res = await post('/update-supervisor').send({ uuid: UUID });
    expect(res.body).toEqual({
      success: true,
      message: 'Update supervisor command sent',
      output: 'step 1\nall done\n',
      lastLine: 'all done',
    });
    expect(cp.spawn.mock.calls[0][1][4]).toBe('22222:127.0.0.1:20123');
    expect(nth(argvOf('ssh')[0], -1)).toBe('/usr/bin/update-balena-supervisor');
    expectNoNewSessions();
  });

  it('/update-supervisor hides stderr in details on failure', async () => {
    cp.execFile.mockImplementation((file: string, _a: any, opts: any, cb?: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (file === 'ssh') callback(new Error('exit 1'), '', 'boom');
      else callback(null, '', '');
    });
    const res = await post('/update-supervisor').send({ uuid: UUID });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'An error occurred while updating Supervisor', details: 'Remote command failed' });
    expect(JSON.stringify(res.body)).not.toMatch(/boom|tunnelKey/);
  });

  it('/upload-ionos runs the backup script and switches SSH off', async () => {
    const res = await post('/upload-ionos').send({ uuid: UUID, configPassword: 'pw' });
    expect(res.body).toEqual({
      success: true,
      message: 'Upload to Ionos command sent',
      output: 'step 1\nall done\n',
      lastLine: 'all done',
    });
    expect(nth(argvOf('ssh')[0], -1)).toBe('/start-scripts/start-backup.sh backup');
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expectNoNewSessions();
  });
});

describe('no shell anywhere', () => {
  it('never calls exec and never passes shell: true', async () => {
    await post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'on' });
    await post('/download-files').send({ uuid: UUID, name: 'n', configPassword: 'pw' });
    await post('/upload-ionos').send({ uuid: UUID, configPassword: 'pw' });
    await settle();
    expect(cp.exec).not.toHaveBeenCalled();
    for (const call of [...cp.execFile.mock.calls, ...cp.spawn.mock.calls]) {
      expect(Array.isArray(call[1])).toBe(true);
      const opts = typeof call[2] === 'object' ? call[2] : undefined;
      expect(opts?.shell).toBeFalsy();
    }
    expect(path.isAbsolute(SESSION_ROOT)).toBe(true);
  });
});

describe('timeouts flow into cleanup', () => {
  it('a hanging scp times out, SSH goes off, tunnel and session are removed', async () => {
    cp.execFile.mockImplementation((file: string, _a: any, opts: any, cb?: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (file !== 'scp') return callback(null, '', '');
      // Hangs unless the caller set a timeout, then fails like a killed child.
      if (opts?.timeout) setTimeout(() => callback(Object.assign(new Error('timed out'), { killed: true }), '', ''), 5);
    });
    const res = await post('/download-files').send({ uuid: UUID, name: 'GW-1', configPassword: 'pw' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'An error occurred while downloading files' });
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expect(tunnels.every((t) => t.kill.mock.calls.length > 0)).toBe(true);
    expectNoNewSessions();
  });
});

describe('concurrency and upload limits', () => {
  const OTHER = 'c'.repeat(32);
  const THIRD = 'd'.repeat(32);

  /** Makes balena login hang until released; returns the release function list. */
  function holdLogins() {
    const releases: (() => void)[] & { pass?: boolean } = [];
    cp.execFile.mockImplementation((file: string, args: string[], opts: any, cb?: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (file === '/usr/bin/balena' && !releases.pass) releases.push(() => callback(null, '', ''));
      else callback(null, '', '');
    });
    return releases;
  }

  it('answers 429 for a second job on the same device before any process starts', async () => {
    const releases = holdLogins();
    const first = post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'on' }).then((r) => r);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const second = await post('/log-level').send({ uuid: UUID, password: 'pw', logLevels: {} });
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ error: 'Device busy, try again shortly' });
    expect(argvOf('/usr/bin/balena')).toHaveLength(1);
    releases.pass = true;
    releases[0]();
    expect((await first).status).toBe(200);
    await settle();
    const third = await post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'off' });
    expect(third.status).toBe(200);
  });

  it('limits a user to two device jobs at a time', async () => {
    const releases = holdLogins();
    const a = post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'on' }).then((r) => r);
    const b = post('/control-ssh').send({ uuid: OTHER, configPassword: 'pw', status: 'on' }).then((r) => r);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const c = await post('/control-ssh').send({ uuid: THIRD, configPassword: 'pw', status: 'on' });
    expect(c.status).toBe(429);
    expect(c.body).toEqual({ error: 'Too many device operations in progress' });
    releases.pass = true;
    releases.forEach((r) => r());
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    await settle();
    expect((await post('/control-ssh').send({ uuid: THIRD, configPassword: 'pw', status: 'on' })).status).toBe(200);
  });

  it('frees the slot after a failed job', async () => {
    cp.execFile.mockImplementation((file: string, _a: any, opts: any, cb?: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(file === '/usr/bin/balena' ? new Error('login failed') : null, '', '');
    });
    const failed = await post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'on' });
    expect(failed.status).toBe(500);
    await settle();
    cp.execFile.mockImplementation((_f: string, _a: any, opts: any, cb?: any) => (typeof opts === 'function' ? opts : cb)(null, '', ''));
    expect((await post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'on' })).status).toBe(200);
  });

  it('an upload at the user limit is refused before multer writes anything', async () => {
    const releases = holdLogins();
    const a = post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'on' }).then((r) => r);
    const b = post('/control-ssh').send({ uuid: OTHER, configPassword: 'pw', status: 'on' }).then((r) => r);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const res = await post('/send-files').field('uuid', THIRD).attach('files', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(429);
    expect(fs.readdirSync('/tmp/uploads').filter((f) => !uploadsBefore.includes(f))).toEqual([]);
    releases.pass = true;
    releases.forEach((r) => r());
    await Promise.all([a, b]);
    await settle();
  });

  it('an upload for a busy device is refused and its temp files removed', async () => {
    const releases = holdLogins();
    const a = post('/control-ssh').send({ uuid: UUID, configPassword: 'pw', status: 'on' }).then((r) => r);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const res = await post('/send-files').field('uuid', UUID).attach('files', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(429);
    expect(fs.readdirSync('/tmp/uploads').filter((f) => !uploadsBefore.includes(f))).toEqual([]);
    releases.pass = true;
    releases[0]();
    await a;
    await settle();
  });

  it('rejects an empty upload with 400 before any process', async () => {
    const res = await post('/send-files').field('uuid', UUID).field('configPassword', 'pw');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No files' });
    expect(cp.execFile).not.toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('rejects more than 5 form fields with 400 JSON', async () => {
    let req = post('/send-files').field('uuid', UUID);
    for (let i = 0; i < 5; i++) req = req.field(`f${i}`, 'x');
    const res = await req.attach('files', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid upload' });
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('rejects more than 25 parts with 400 JSON', async () => {
    let req = post('/send-files').field('uuid', UUID);
    for (let i = 0; i < 25; i++) req = req.attach('files', Buffer.from('x'), `f${i}.txt`);
    const res = await req;
    expect(res.status).toBe(400);
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});

describe('/download-logs failure detection', () => {
  it('returns 502 JSON when ssh/tar exits non-zero before any data', async () => {
    const pending = post('/download-logs').send({ uuid: UUID, name: 'GW-1', configPassword: 'pw' }).then((r) => r);
    await vi.waitFor(() => expect(tarChild).toBeDefined());
    tarChild.stdout.end();
    tarChild.exitCode = 255;
    tarChild.emit('close', 255);
    const res = await pending;
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Log archive failed' });
    expect(res.headers['content-disposition']).toBeUndefined();
    await settle();
    expect(sshStates()).toEqual(['on', 'off']);
    expectNoNewSessions();
  });

  it('returns 502 JSON when the process closes with no data even on exit 0', async () => {
    const pending = post('/download-logs').send({ uuid: UUID, name: 'GW-1', configPassword: 'pw' }).then((r) => r);
    await vi.waitFor(() => expect(tarChild).toBeDefined());
    tarChild.stdout.end();
    tarChild.exitCode = 0;
    tarChild.emit('close', 0);
    expect((await pending).status).toBe(502);
  });

  it('sends headers only with the first data chunk', async () => {
    const pending = post('/download-logs').send({ uuid: UUID, name: 'GW-1', configPassword: 'pw' }).then((r) => r);
    await vi.waitFor(() => expect(tarChild).toBeDefined());
    tarChild.stdout.end('TAR');
    tarChild.exitCode = 0;
    tarChild.emit('close', 0);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/gzip');
  });
});
