import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import portfinder from 'portfinder';
import waitPort from 'wait-port';
import { HttpError } from './httpError';

// External commands run with argv arrays only (execFile/spawn, never a shell).

export const BALENA_BIN = '/usr/bin/balena';
export const TUNNEL_KEY = '/certs/tunnelKey/tunnelKey';
export const SESSION_ROOT = '/tmp/sessions';
export const GATEWAY_CONFIG_PORT = 8099;
export const GATEWAY_SSH_PORT = 12738;
export const HOST_SSH_PORT = 22222;

const SSH_OPTS = [
  '-o',
  'StrictHostKeyChecking=no',
  '-o',
  'UserKnownHostsFile=/dev/null',
  '-o',
  'ConnectTimeout=20',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=4',
];

export const LOGIN_TIMEOUT_MS = 60_000;
export const TRANSFER_TIMEOUT_MS = 15 * 60_000;
export const GATEWAY_FETCH_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 5_000;
const REMOTE = 'root@127.0.0.1';
const UUID_RE = /^[0-9a-f]{32,62}$/;
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]+$/;

const DOWNLOAD_SOURCES = {
  outbound: '/opt/spaceport/outbound/*',
  backup: '/backup/backup_*',
} as const;
export type DownloadSource = keyof typeof DOWNLOAD_SOURCES;

const SSH_COMMANDS = {
  'update-supervisor': '/usr/bin/update-balena-supervisor',
  'ionos-backup': '/start-scripts/start-backup.sh backup',
} as const;
export type SshCommand = keyof typeof SSH_COMMANDS;

export interface TunnelHandle {
  tunnelProcess: ChildProcess;
  tunnelPort: number;
}

export interface Session {
  dir: string;
  cleanup: () => void;
}

/** Thrown by sshRun; `output` is the remote stderr (or the error message). */
export class SshCommandError extends Error {
  constructor(public readonly output: string) {
    super(output);
  }
}

export function isValidUuid(uuid: unknown): uuid is string {
  return typeof uuid === 'string' && UUID_RE.test(uuid);
}

export function assertUuid(uuid: unknown): string {
  if (!isValidUuid(uuid)) throw new HttpError(400, 'Invalid device uuid');
  return uuid;
}

/** Basename only, [A-Za-z0-9._-] (others → `_`), no leading dot, max 200 chars. */
export function sanitizeFileName(name: unknown): string {
  const base = typeof name === 'string' ? (name.split(/[\\/]/).pop() ?? '') : '';
  const safe = base
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, (dots) => '_'.repeat(dots.length))
    .slice(0, 200);
  if (!safe) throw new HttpError(400, 'Invalid file name');
  return safe;
}

/** Sanitizes every name first (throws on any invalid one), then suffixes `_1`, `_2`… before the extension on collisions. */
export function uniqueFileNames(names: unknown[]): string[] {
  const safe = names.map(sanitizeFileName);
  const used = new Set<string>();
  return safe.map((name) => {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0 && name.length - dot <= 20 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let i = 1; used.has(candidate); i++) {
      const suffix = `_${i}${ext}`;
      candidate = base.slice(0, 200 - suffix.length) + suffix;
    }
    used.add(candidate);
    return candidate;
  });
}

function assertPort(port: unknown): string {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port');
  }
  return String(port);
}

function run(
  file: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout: number },
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, { ...options, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      const out = { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
      if (error) reject(Object.assign(error, out));
      else resolve(out);
    });
  });
}

const balenaEnv = (dir: string) => ({ ...process.env, BALENARC_DATA_DIRECTORY: dir });

/** Private balena-cli data dir under /tmp/sessions/<random>, mode 0700. */
export function createSession(): Session {
  fs.mkdirSync(SESSION_ROOT, { recursive: true });
  const dir = path.join(SESSION_ROOT, randomUUID());
  fs.mkdirSync(dir, { mode: 0o700 });
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export const UPLOAD_ROOT = '/tmp/uploads';

/** Removes leftovers of crashed runs from the session and upload dirs (best effort). */
export function sweepTempDirs(roots: string[] = [SESSION_ROOT, UPLOAD_ROOT]): void {
  for (const root of roots) {
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      try {
        fs.rmSync(path.join(root, entry), { recursive: true, force: true });
      } catch (error: any) {
        console.error(`Startup sweep: could not remove ${root}/${entry}:`, error?.message);
      }
    }
    console.log(`Startup sweep: cleaned ${entries.length} entries in ${root}`);
  }
}

export async function balenaLogin(token: string, dir: string): Promise<void> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token) || token.startsWith('-')) {
    throw new HttpError(400, 'Invalid token');
  }
  try {
    await run(BALENA_BIN, ['login', '--token', token, '--unsupported'], { env: balenaEnv(dir), timeout: LOGIN_TIMEOUT_MS });
  } catch (error: any) {
    console.error('Login failed:', error?.message);
    throw new Error('Failed to authenticate with Balena');
  }
}

/** SIGTERM now; SIGKILL if the process is still alive after the grace period. */
export function killChild(child?: ChildProcess): void {
  if (!child) return;
  try {
    child.kill();
  } catch (error) {
    console.error('Error killing child process:', error);
    return;
  }
  const timer = setTimeout(() => {
    if (child.exitCode !== null && child.exitCode !== undefined) return;
    if (child.signalCode) return;
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }, KILL_GRACE_MS);
  timer.unref();
  child.once?.('exit', () => clearTimeout(timer));
}

export const cleanupTunnel = killChild;

/** Forwards device port `remotePort` to a free local port. */
export async function openTunnel(uuid: string, remotePort: number, dir: string): Promise<TunnelHandle> {
  assertUuid(uuid);
  const remote = assertPort(remotePort);
  const tunnelPort = await portfinder.getPortPromise({ port: 20000, stopPort: 29999 });
  const tunnelProcess = spawn(
    BALENA_BIN,
    ['device', 'tunnel', uuid, '-p', `${remote}:127.0.0.1:${tunnelPort}`, '--unsupported'],
    { env: balenaEnv(dir) },
  );
  tunnelProcess.stdout?.on('data', (data) => console.log(`Tunnel stdout: ${data}`));
  tunnelProcess.stderr?.on('data', (data) => console.error(`Tunnel stderr: ${data}`));
  tunnelProcess.on('error', (error) => console.error('Tunnel error:', error.message));
  const open = await waitPort({ host: '127.0.0.1', port: tunnelPort, timeout: 20000 }).catch(() => false);
  if (!open) {
    cleanupTunnel(tunnelProcess);
    throw new Error('Failed to open tunnel');
  }
  return { tunnelProcess, tunnelPort };
}

async function postGatewayConfig(
  uuid: string,
  configPassword: string,
  apiPath: string,
  body: unknown,
  dir: string,
  failure: string,
): Promise<any> {
  const handle = await openTunnel(uuid, GATEWAY_CONFIG_PORT, dir);
  try {
    const response = await fetch(`http://127.0.0.1:${handle.tunnelPort}${apiPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`ConfigUser:${configPassword}`).toString('base64')}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATEWAY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const message = `${failure}: ${response.statusText}`;
      console.error(message);
      throw new HttpError(response.status, message);
    }
    return await response.json();
  } finally {
    cleanupTunnel(handle.tunnelProcess);
  }
}

export async function setSshState(
  uuid: string,
  configPassword: string,
  state: 'on' | 'off',
  dir: string,
): Promise<any> {
  if (state !== 'on' && state !== 'off') throw new HttpError(400, 'Invalid SSH state');
  return postGatewayConfig(uuid, configPassword, '/system/config/ssh', { state }, dir, 'Failed to change SSH status');
}

export async function setLogLevel(uuid: string, configPassword: string, logLevels: unknown, dir: string): Promise<any> {
  return postGatewayConfig(
    uuid,
    configPassword,
    '/system/config/loglevel',
    { logLevel: logLevels },
    dir,
    'Failed to update log level',
  );
}

/** Copies a local file to /opt/spaceport/<sanitized name> on the device. */
export async function scpUpload(port: number, localPath: string, remoteName: string): Promise<void> {
  const p = assertPort(port);
  const safeName = sanitizeFileName(remoteName);
  await run('scp', ['-i', TUNNEL_KEY, '-P', p, ...SSH_OPTS, localPath, `${REMOTE}:/opt/spaceport/${safeName}`], {
    timeout: TRANSFER_TIMEOUT_MS,
  });
}

/** Copies a fixed remote file set into `destDir` (created if missing). */
export async function scpDownloadDir(port: number, destDir: string, source: DownloadSource = 'outbound'): Promise<void> {
  const p = assertPort(port);
  if (!Object.prototype.hasOwnProperty.call(DOWNLOAD_SOURCES, source)) throw new HttpError(400, 'Invalid download source');
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  const remotePath = DOWNLOAD_SOURCES[source];
  await run('scp', ['-i', TUNNEL_KEY, '-P', p, '-r', ...SSH_OPTS, `${REMOTE}:${remotePath}`, destDir], {
    timeout: TRANSFER_TIMEOUT_MS,
  });
}

export async function zipDir(srcDir: string, zipPath: string): Promise<void> {
  await run('zip', ['-r', zipPath, '.'], { cwd: srcDir, timeout: TRANSFER_TIMEOUT_MS });
}

/** Streams a gzipped tar of /var/log/dcgw from the device on stdout. */
export function sshTarStream(port: number): ChildProcess {
  const p = assertPort(port);
  return spawn('ssh', ['-i', TUNNEL_KEY, '-p', p, ...SSH_OPTS, REMOTE, 'tar czf - -C /var/log/dcgw .']);
}

/** Runs a fixed remote command; resolves stdout (or stderr when stdout is empty). */
export async function sshRun(port: number, command: SshCommand): Promise<string> {
  const p = assertPort(port);
  if (!Object.prototype.hasOwnProperty.call(SSH_COMMANDS, command)) throw new HttpError(400, 'Invalid command');
  const remoteCommand = SSH_COMMANDS[command];
  try {
    const { stdout, stderr } = await run('ssh', ['-i', TUNNEL_KEY, '-p', p, ...SSH_OPTS, REMOTE, remoteCommand], {
      timeout: TRANSFER_TIMEOUT_MS,
    });
    return stdout || stderr;
  } catch (error: any) {
    throw new SshCommandError(error?.stderr || error?.message || 'ssh failed');
  }
}
