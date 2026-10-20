// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const cp = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn(), exec: vi.fn() }));
vi.mock('node:child_process', () => ({ ...cp, default: cp }));
vi.mock('portfinder', () => ({ default: { getPortPromise: vi.fn(async (o: { port: number }) => Math.max(o.port, 20123)) } }));
vi.mock('wait-port', () => ({ default: vi.fn(async () => true) }));

import waitPort from 'wait-port';
import {
  assertUuid,
  isValidUuid,
  sanitizeFileName,
  uniqueFileNames,
  createSession,
  balenaLogin,
  openTunnel,
  resetTunnelPorts,
  cleanupTunnel,
  killChild,
  sweepTempDirs,
  setSshState,
  setLogLevel,
  scpUpload,
  scpDownloadDir,
  zipDir,
  sshTarStream,
  sshRun,
  SshCommandError,
  SESSION_ROOT,
  TUNNEL_KEY,
} from '../deviceShell';
import { HttpError } from '../httpError';

const UUID = 'a'.repeat(32);
const HOSTILE = ['a;rm -rf /', '$(id)', '`id`', '../../etc/passwd', 'abc\nid', 'a b', ''];
const HOSTILE_FILES = ['a;rm -rf x', '$(id)', '`id`', '../../etc/passwd', 'abc\nid', 'a b', '-oProxyCommand=id'];

const nth = (arr: any, i: number): string => arr[arr.length + i];

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.kill = vi.fn();
  return child;
}

function okExecFile(stdout = '', stderr = '') {
  cp.execFile.mockImplementation((_file: string, _args: string[], opts: any, cb?: any) => {
    const callback = typeof opts === 'function' ? opts : cb;
    callback(null, stdout, stderr);
    return fakeChild();
  });
}

function mockFetch(status: number, body: any = {}) {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `S${status}`,
    json: async () => body,
  })) as any;
}

function assertNoShell(call: any[]) {
  const opts = call.find((a, i) => i > 1 && a && typeof a === 'object' && !Array.isArray(a));
  expect(Array.isArray(call[1])).toBe(true);
  expect(opts?.shell).toBeFalsy();
}

beforeEach(() => {
  resetTunnelPorts();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  cp.execFile.mockReset();
  cp.spawn.mockReset();
  cp.exec.mockReset();
  cp.spawn.mockImplementation(() => fakeChild());
  (waitPort as any).mockResolvedValue(true);
  okExecFile();
});

describe('uuid validation', () => {
  it('accepts lowercase hex of 32..62 chars', () => {
    expect(assertUuid(UUID)).toBe(UUID);
    expect(isValidUuid('0'.repeat(62))).toBe(true);
  });

  it.each([...HOSTILE, 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(63), 42, undefined])(
    'rejects %j with HttpError 400',
    (bad) => {
      expect(isValidUuid(bad)).toBe(false);
      try {
        assertUuid(bad);
        throw new Error('not thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).status).toBe(400);
      }
    },
  );
});

describe('sanitizeFileName', () => {
  it.each([
    ['report.csv', 'report.csv'],
    ['a;rm -rf x', 'a_rm_-rf_x'],
    ['$(id)', '__id_'],
    ['`id`', '_id_'],
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\boot.ini', 'boot.ini'],
    ['abc\nid', 'abc_id'],
    ['my file (1).txt', 'my_file__1_.txt'],
    ['.bashrc', '_bashrc'],
    ['..', '__'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('caps the length at 200', () => {
    expect(sanitizeFileName('x'.repeat(500))).toHaveLength(200);
  });

  it.each(['', '/', 'dir/', 'a;rm -rf /', undefined])('rejects %j', (bad) => {
    expect(() => sanitizeFileName(bad as any)).toThrow(HttpError);
  });

  it('only ever yields the safe alphabet', () => {
    for (const h of HOSTILE_FILES) {
      expect(sanitizeFileName(h)).toMatch(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/);
    }
  });
});

describe('uniqueFileNames', () => {
  it('sanitizes and de-duplicates before the extension', () => {
    expect(uniqueFileNames(['a.txt', 'a.txt', 'a_1.txt', 'b', 'b', '$(x).txt', '_(x).txt'])).toEqual([
      'a.txt',
      'a_1.txt',
      'a_1_1.txt',
      'b',
      'b_1',
      '__x_.txt',
      '__x__1.txt',
    ]);
  });

  it('keeps de-duplicated names within 200 chars', () => {
    const long = 'x'.repeat(300) + '.log';
    const [a, b] = uniqueFileNames([long, long]);
    expect(a).toHaveLength(200);
    expect(b).toHaveLength(200);
    expect(a).not.toBe(b);
    expect(b.endsWith('_1')).toBe(true);
  });

  it('rejects the whole batch when any name is invalid', () => {
    expect(() => uniqueFileNames(['ok.txt', 'dir/'])).toThrow(HttpError);
  });
});

describe('createSession', () => {
  it('creates a 0700 dir named by a random UUID under the session root and removes it', () => {
    const s = createSession();
    expect(path.dirname(s.dir)).toBe(SESSION_ROOT);
    expect(path.basename(s.dir)).toMatch(/^[0-9a-f-]{36}$/);
    expect(fs.statSync(s.dir).mode & 0o777).toBe(0o700);
    s.cleanup();
    expect(fs.existsSync(s.dir)).toBe(false);
  });

  it('gives each session its own dir', () => {
    const a = createSession();
    const b = createSession();
    expect(a.dir).not.toBe(b.dir);
    a.cleanup();
    b.cleanup();
  });
});

describe('balenaLogin', () => {
  it('runs balena via execFile with an argv array and the session env', async () => {
    await balenaLogin('eyJ.abc-_.sig', '/tmp/sessions/x');
    const call = cp.execFile.mock.calls[0];
    expect(call[0]).toBe('/usr/bin/balena');
    expect(call[1]).toEqual(['login', '--token', 'eyJ.abc-_.sig', '--unsupported']);
    expect(call[2].env.BALENARC_DATA_DIRECTORY).toBe('/tmp/sessions/x');
    assertNoShell(call);
    expect(cp.exec).not.toHaveBeenCalled();
  });

  it.each(['a;id', '$(id)', '-x', 'tok en', ''])('rejects token %j without running anything', async (tok) => {
    await expect(balenaLogin(tok, '/tmp/sessions/x')).rejects.toBeInstanceOf(HttpError);
    expect(cp.execFile).not.toHaveBeenCalled();
  });

  it('maps a failed login to a generic error', async () => {
    cp.execFile.mockImplementation((_f: any, _a: any, _o: any, cb: any) => cb(new Error('boom'), '', ''));
    await expect(balenaLogin('tok', '/tmp/sessions/x')).rejects.toThrow('Failed to authenticate with Balena');
  });
});

describe('openTunnel', () => {
  it('spawns balena device tunnel with argv and no shell', async () => {
    const handle = await openTunnel(UUID, 8099, '/tmp/sessions/x');
    const call = cp.spawn.mock.calls[0];
    expect(call[0]).toBe('/usr/bin/balena');
    expect(call[1]).toEqual(['device', 'tunnel', UUID, '-p', '8099:127.0.0.1:20123', '--unsupported']);
    expect(call[2].shell).toBeFalsy();
    expect(call[2].env.BALENARC_DATA_DIRECTORY).toBe('/tmp/sessions/x');
    expect(handle.tunnelPort).toBe(20123);
  });

  it.each(HOSTILE)('refuses hostile uuid %j before spawning', async (bad) => {
    await expect(openTunnel(bad, 8099, '/tmp/sessions/x')).rejects.toBeInstanceOf(HttpError);
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('never hands the same local port to two live tunnels', async () => {
    cp.spawn.mockImplementation(() => fakeChild());
    const [a, b] = await Promise.all([openTunnel(UUID, 8099, '/tmp/sessions/x'), openTunnel('b'.repeat(32), 8099, '/tmp/sessions/y')]);
    expect(a.tunnelPort).not.toBe(b.tunnelPort);
  });

  it('frees the port once the tunnel exits', async () => {
    const first = fakeChild();
    cp.spawn.mockReturnValueOnce(first).mockImplementation(() => fakeChild());
    const a = await openTunnel(UUID, 8099, '/tmp/sessions/x');
    first.emit('exit', 0);
    const b = await openTunnel(UUID, 8099, '/tmp/sessions/x');
    expect(b.tunnelPort).toBe(a.tunnelPort);
  });

  it('fails when the tunnel exits before its port opens, even if something else listens', async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    let resolvePort: (v: boolean) => void = () => {};
    (waitPort as any).mockReturnValue(new Promise((r) => (resolvePort = r)));
    const pending = openTunnel(UUID, 8099, '/tmp/sessions/x');
    await new Promise((r) => setTimeout(r, 0));
    child.exitCode = 1;
    child.emit('exit', 1);
    resolvePort(true);
    await expect(pending).rejects.toThrow('Failed to open tunnel');
  });

  it('kills the tunnel when the port never opens', async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    (waitPort as any).mockResolvedValue(false);
    await expect(openTunnel(UUID, 8099, '/tmp/sessions/x')).rejects.toThrow('Failed to open tunnel');
    expect(child.kill).toHaveBeenCalled();
  });

  it('cleanupTunnel kills the process and tolerates undefined', () => {
    const child = fakeChild();
    cleanupTunnel(child);
    expect(child.kill).toHaveBeenCalled();
    expect(() => cleanupTunnel(undefined)).not.toThrow();
  });
});

describe('gateway config API calls', () => {
  it('setSshState POSTs state through an 8099 tunnel and closes it', async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    mockFetch(200, { ok: 1 });
    await expect(setSshState(UUID, 'pw', 'on', '/tmp/sessions/x')).resolves.toEqual({ ok: 1 });
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:20123/system/config/ssh');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('ConfigUser:pw').toString('base64')}`);
    expect(JSON.parse(init.body)).toEqual({ state: 'on' });
    expect(cp.spawn.mock.calls[0][1][4]).toBe('8099:127.0.0.1:20123');
    expect(child.kill).toHaveBeenCalled();
  });

  it('setSshState rejects anything but on/off before opening a tunnel', async () => {
    mockFetch(200);
    await expect(setSshState(UUID, 'pw', 'on;id' as any, '/tmp/sessions/x')).rejects.toMatchObject({ status: 400 });
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('setSshState surfaces a gateway failure as HttpError with its status', async () => {
    mockFetch(401);
    await expect(setSshState(UUID, 'pw', 'off', '/tmp/sessions/x')).rejects.toMatchObject({
      status: 401,
      message: 'Failed to change SSH status: S401',
    });
  });

  it('setLogLevel POSTs logLevel and surfaces failures with the admin message', async () => {
    mockFetch(200, { done: true });
    await expect(setLogLevel(UUID, 'pw', { core: 'DEBUG' }, '/tmp/sessions/x')).resolves.toEqual({ done: true });
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:20123/system/config/loglevel');
    expect(JSON.parse(init.body)).toEqual({ logLevel: { core: 'DEBUG' } });
    mockFetch(500);
    await expect(setLogLevel(UUID, 'pw', {}, '/tmp/sessions/x')).rejects.toMatchObject({
      status: 500,
      message: 'Failed to update log level: S500',
    });
  });
});

describe('scp / ssh helpers', () => {
  const sshOpts = [
    '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
  ];

  it('scpUpload passes the sanitized name as the only remote path', async () => {
    await scpUpload(20123, '/tmp/uploads/abc', '$(id);x y\n../z');
    const call = cp.execFile.mock.calls[0];
    expect(call[0]).toBe('scp');
    expect(call[1]).toEqual([
      '-i', TUNNEL_KEY, '-P', '20123', ...sshOpts,
      '/tmp/uploads/abc', 'root@127.0.0.1:/opt/spaceport/z',
    ]);
    assertNoShell(call);
  });

  it.each(HOSTILE_FILES)('scpUpload never puts hostile %j into argv raw', async (name) => {
    await scpUpload(20123, '/tmp/uploads/abc', name);
    const target: string = nth(cp.execFile.mock.calls[0][1], -1);
    expect(target).toMatch(/^root@127\.0\.0\.1:\/opt\/spaceport\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/);
  });

  it('scpDownloadDir copies the outbound dir recursively into the given dir', async () => {
    const s = createSession();
    const dest = path.join(s.dir, 'dl');
    await scpDownloadDir(20123, dest);
    const call = cp.execFile.mock.calls[0];
    expect(call[0]).toBe('scp');
    expect(call[1]).toEqual([
      '-i', TUNNEL_KEY, '-P', '20123', '-r', ...sshOpts,
      'root@127.0.0.1:/opt/spaceport/outbound/*', dest,
    ]);
    assertNoShell(call);
    expect(fs.existsSync(dest)).toBe(true);
    s.cleanup();
  });

  it('scpDownloadDir can fetch the backup archive set', async () => {
    const s = createSession();
    await scpDownloadDir(20123, path.join(s.dir, 'dl'), 'backup');
    expect(nth(cp.execFile.mock.calls[0][1], -2)).toBe('root@127.0.0.1:/backup/backup_*');
    s.cleanup();
  });

  it('zipDir zips via execFile with cwd', async () => {
    await zipDir('/tmp/sessions/s/dl', '/tmp/sessions/s/out.zip');
    const call = cp.execFile.mock.calls[0];
    expect(call[0]).toBe('zip');
    expect(call[1]).toEqual(['-r', '/tmp/sessions/s/out.zip', '.']);
    expect(call[2].cwd).toBe('/tmp/sessions/s/dl');
    assertNoShell(call);
  });

  it('sshTarStream spawns ssh with a constant remote command', () => {
    sshTarStream(20123);
    const call = cp.spawn.mock.calls[0];
    expect(call[0]).toBe('ssh');
    expect(call[1]).toEqual([
      '-i', TUNNEL_KEY, '-p', '20123', ...sshOpts, 'root@127.0.0.1', 'tar czf - -C /var/log/dcgw .',
    ]);
    expect(call[2]?.shell).toBeFalsy();
  });

  it('sshRun maps a named command to a constant remote command', async () => {
    okExecFile('line1\nline2\n');
    await expect(sshRun(20123, 'update-supervisor')).resolves.toBe('line1\nline2\n');
    expect(cp.execFile.mock.calls[0][1]).toEqual([
      '-i', TUNNEL_KEY, '-p', '20123', ...sshOpts, 'root@127.0.0.1', '/usr/bin/update-balena-supervisor',
    ]);
    okExecFile('', 'only-stderr');
    await expect(sshRun(20123, 'ionos-backup')).resolves.toBe('only-stderr');
    expect(nth(cp.execFile.mock.calls[1][1], -1)).toBe('/start-scripts/start-backup.sh backup');
  });

  it('sshRun and scpDownloadDir ignore inherited keys', async () => {
    await expect(sshRun(20123, 'toString' as any)).rejects.toBeInstanceOf(HttpError);
    await expect(scpDownloadDir(20123, '/tmp/sessions/none', 'constructor' as any)).rejects.toBeInstanceOf(HttpError);
    expect(cp.execFile).not.toHaveBeenCalled();
  });

  it('sshRun rejects unknown commands and wraps failures with the output', async () => {
    await expect(sshRun(20123, 'rm -rf /' as any)).rejects.toBeInstanceOf(HttpError);
    cp.execFile.mockImplementation((_f: any, _a: any, _o: any, cb: any) => cb(new Error('exit 1'), '', 'bad'));
    const err = await sshRun(20123, 'update-supervisor').catch((e) => e);
    expect(err).toBeInstanceOf(SshCommandError);
    expect(err.output).toBe('bad');
  });

  it('rejects non-integer ports', async () => {
    await expect(scpUpload('1 -oProxyCommand=x' as any, '/tmp/a', 'b')).rejects.toThrow();
    expect(() => sshTarStream(NaN)).toThrow();
    expect(cp.execFile).not.toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('never uses exec', () => {
    expect(cp.exec).not.toHaveBeenCalled();
  });
});

describe('timeouts', () => {
  /** execFile that never answers unless a timeout is set, then fails like a killed child. */
  function hangUnlessTimeout() {
    cp.execFile.mockImplementation((_f: string, _a: string[], opts: any, cb: any) => {
      if (opts?.timeout) setTimeout(() => cb(Object.assign(new Error('timed out'), { killed: true, signal: opts.killSignal }), '', ''), 5);
    });
  }

  it('every external command runs with a timeout and SIGKILL', async () => {
    await balenaLogin('tok', '/tmp/sessions/x');
    await scpUpload(20123, '/tmp/a', 'b');
    await scpDownloadDir(20123, '/tmp/dl-timeout-test');
    await zipDir('/tmp/a', '/tmp/a.zip');
    await sshRun(20123, 'update-supervisor');
    const opts = cp.execFile.mock.calls.map((c) => c[2]);
    expect(opts.map((o) => o.timeout)).toEqual([60_000, 900_000, 900_000, 900_000, 900_000]);
    expect(opts.every((o) => o.killSignal === 'SIGKILL')).toBe(true);
    fs.rmSync('/tmp/dl-timeout-test', { recursive: true, force: true });
  });

  it('a hanging login times out into the generic error', async () => {
    hangUnlessTimeout();
    await expect(balenaLogin('tok', '/tmp/sessions/x')).rejects.toThrow('Failed to authenticate with Balena');
  });

  it('a hanging scp rejects instead of waiting forever', async () => {
    hangUnlessTimeout();
    await expect(scpUpload(20123, '/tmp/a', 'b')).rejects.toMatchObject({ killed: true });
  });

  it('a hanging ssh command surfaces as SshCommandError', async () => {
    hangUnlessTimeout();
    await expect(sshRun(20123, 'ionos-backup')).rejects.toBeInstanceOf(SshCommandError);
  });

  it('gateway calls abort after 30 s and still close the tunnel', async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    global.fetch = vi.fn((_url: string, init: any) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    }) as any;
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      expect(ms).toBe(30_000);
      const c = new AbortController();
      setTimeout(() => c.abort(new Error('aborted')), 5);
      return c.signal;
    });
    await expect(setSshState(UUID, 'pw', 'on', '/tmp/sessions/x')).rejects.toThrow('aborted');
    expect(spy).toHaveBeenCalledWith(30_000);
    expect(child.kill).toHaveBeenCalled();
  });
});

describe('killChild', () => {
  afterEach(() => vi.useRealTimers());

  it('escalates to SIGKILL when SIGTERM does not end the process within 5 s', () => {
    vi.useFakeTimers();
    const child = fakeChild();
    killChild(child);
    expect(child.kill).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4_999);
    expect(child.kill).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
  });

  it('does not escalate when the process exits', () => {
    vi.useFakeTimers();
    const child = fakeChild();
    killChild(child);
    child.emit('exit', 0);
    vi.advanceTimersByTime(10_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('openTunnel kills a tunnel whose port never opens, with escalation', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    (waitPort as any).mockResolvedValue(false);
    await expect(openTunnel(UUID, 8099, '/tmp/sessions/x')).rejects.toThrow('Failed to open tunnel');
    vi.advanceTimersByTime(5_000);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
  });
});

describe('sweepTempDirs', () => {
  it('removes leftovers but keeps the directories', () => {
    const root = fs.mkdtempSync(path.join('/tmp', 'sweep-'));
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    fs.mkdirSync(path.join(a, 'nested'), { recursive: true });
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, 'f'), 'x');
    fs.writeFileSync(path.join(a, 'nested', 'g'), 'x');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    sweepTempDirs([a, b, path.join(root, 'missing')]);
    expect(fs.readdirSync(a)).toEqual([]);
    expect(fs.readdirSync(b)).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
