import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  GATEWAY_SSH_PORT,
  balenaLogin,
  cleanupTunnel,
  killChild,
  createSession,
  openTunnel,
  scpDownloadDir,
  scpUpload,
  setSshState,
  sshTarStream,
  zipDir,
  type DownloadSource,
  type Session,
  type TunnelHandle,
} from './deviceShell';

/** Header-safe form of the device name used in download file names. */
export const headerName = (name: unknown) => String(name ?? '').replace(/[^A-Za-z0-9._-]/g, '_');

/** Short device name used in download file names: text before the first '-', sanitized. */
export const shortName = (name: unknown, uuid?: string) =>
  headerName(String(name ?? '').split('-')[0]) || (uuid ?? '').slice(0, 8);

export const MAX_JOBS_PER_USER = 2;
const userJobs = new Map<string, number>();
const busyDevices = new Set<string>();

export const BUSY_DEVICE = 'Device busy, try again shortly';
export const BUSY_USER = 'Too many device operations in progress';

export const userKey = (req: Request): string => String(req.user?.id ?? 'anonymous');

/** True when the user already runs the maximum number of device jobs. */
export function userAtLimit(user: string): boolean {
  return (userJobs.get(user) ?? 0) >= MAX_JOBS_PER_USER;
}

/** Multer limit/parse errors → JSON responses (413 for size, 400 otherwise). */
export function parseUploads(upload: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (err: unknown) => {
      if (!err) return next();
      console.error('upload rejected:', err);
      if ((err as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large' });
      } else {
        res.status(400).json({ error: 'Invalid upload' });
      }
    });
  };
}

/** Thrown at a checkpoint once the client has gone away. */
export class ClientGone extends Error {}

/**
 * Per-request device state: balena session, SSH tunnel and whether SSH was switched on.
 * Watches the response from the start so a client that leaves early still triggers cleanup.
 */
export class DeviceJob {
  session?: Session;
  tunnel?: TunnelHandle;
  sshOn = false;
  /** Set while a stream is piping; called when the client goes away. */
  onClientGone?: () => void;
  private gone = false;
  private finished = false;
  private started = false;
  private holdsSlots = false;

  constructor(
    readonly uuid: string,
    private readonly configPassword: string,
    private readonly res: Response,
    private readonly user: string = 'anonymous',
  ) {
    res.on('close', () => {
      if (!res.writableFinished) {
        this.gone = true;
        this.onClientGone?.();
      }
      // Answered or abandoned before any work started (rejected upload, client left): free the slots.
      if (!this.started) void this.finish('early end');
    });
  }

  /** Takes a per-user and per-device slot; answers 429 and returns false when none is free. */
  reserve(): boolean {
    if (busyDevices.has(this.uuid)) {
      this.res.status(429).json({ error: BUSY_DEVICE });
      return false;
    }
    if (userAtLimit(this.user)) {
      this.res.status(429).json({ error: BUSY_USER });
      return false;
    }
    busyDevices.add(this.uuid);
    userJobs.set(this.user, (userJobs.get(this.user) ?? 0) + 1);
    this.holdsSlots = true;
    return true;
  }

  private release(): void {
    if (!this.holdsSlots) return;
    this.holdsSlots = false;
    busyDevices.delete(this.uuid);
    const left = (userJobs.get(this.user) ?? 1) - 1;
    if (left > 0) userJobs.set(this.user, left);
    else userJobs.delete(this.user);
  }

  /** Throws ClientGone when the client has disconnected. */
  checkClient(): void {
    if (this.gone || this.res.destroyed) throw new ClientGone('client disconnected');
  }

  async login(token: string): Promise<string> {
    this.started = true;
    this.session = createSession();
    await balenaLogin(token, this.session.dir);
    this.checkClient();
    return this.session.dir;
  }

  /** SSH counts as on before the call returns: the gateway may apply it even if the request fails. */
  async openSsh(): Promise<number> {
    this.sshOn = true;
    await setSshState(this.uuid, this.configPassword, 'on', this.session!.dir);
    this.checkClient();
    this.tunnel = await openTunnel(this.uuid, GATEWAY_SSH_PORT, this.session!.dir);
    this.checkClient();
    return this.tunnel.tunnelPort;
  }

  /** Sends an error response unless the client is gone or headers are out. */
  fail(status: number, body: object, error?: unknown): void {
    if (error && !(error instanceof ClientGone)) console.error(body, error);
    if (this.res.headersSent || this.res.destroyed) return;
    this.res.status(status).json(body);
  }

  /** Switches SSH back off (if it was switched on), kills the tunnel, removes the session. Runs once. */
  async finish(label: string): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    try {
      if (this.sshOn) await setSshState(this.uuid, this.configPassword, 'off', this.session!.dir);
    } catch (err: any) {
      console.error(`Failed to disable SSH after ${label}:`, err?.message || err);
    } finally {
      cleanupTunnel(this.tunnel?.tunnelProcess);
      this.session?.cleanup();
      this.release();
    }
  }
}

/** Uploads temp files to the device (names already validated), deleting each temp file as it goes. */
export async function uploadFiles(
  job: DeviceJob,
  token: string,
  files: Express.Multer.File[],
  remoteNames: string[],
): Promise<void> {
  await job.login(token);
  const port = await job.openSsh();
  for (const [i, file] of files.entries()) {
    try {
      job.checkClient();
      await scpUpload(port, file.path, remoteNames[i]);
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  }
}

/** Streams the device log archive as tar.gz; the job finishes when the remote tar ends. */
export async function streamLogs(job: DeviceJob, res: Response, token: string, name: unknown): Promise<void> {
  await job.login(token);
  const port = await job.openSsh();
  job.checkClient();
  // Compress on the device and stream the archive out; headers go out with the first data chunk.
  const child = sshTarStream(port);
  let sentData = false;
  let stdoutEnded = false;
  let exitCode: number | null | undefined;
  // If the client aborts mid-download, stop the remote tar; its close event finishes the job.
  job.onClientGone = () => {
    if (child.exitCode === null) killChild(child);
  };
  let stderr = '';
  child.stderr!.on('data', (d) => {
    stderr += d.toString();
  });
  // Ends the response once both the process and its stdout are done.
  const settle = () => {
    if (exitCode === undefined || (!stdoutEnded && !res.destroyed)) return;
    if (!sentData) job.fail(502, { error: 'Log archive failed' });
    else if (exitCode !== 0) res.destroy();
    else res.end();
  };
  child.stdout!.once('data', (chunk: Buffer) => {
    sentData = true;
    res.setHeader('Content-Disposition', `attachment; filename="logs_${headerName(name)}.tar.gz"`);
    res.setHeader('Content-Type', 'application/gzip');
    res.write(chunk);
    child.stdout!.pipe(res, { end: false });
  });
  child.stdout!.on('end', () => {
    stdoutEnded = true;
    settle();
  });
  child.on('error', (err) => {
    console.error('log archive failed to start:', err.message);
    if (sentData) res.destroy();
    else job.fail(502, { error: 'Log archive failed' });
    void job.finish('logs');
  });
  child.on('close', (code) => {
    if (code !== 0) console.error(`log archive failed (exit ${code}): ${stderr}`);
    exitCode = code;
    settle();
    void job.finish('logs');
  });
}

/** Copies a device directory, zips it and streams the zip; the job finishes when the stream closes. */
export async function streamZip(
  job: DeviceJob,
  res: Response,
  token: string,
  source: DownloadSource,
  filePrefix: string,
  name: unknown,
  label: string,
): Promise<void> {
  const dir = await job.login(token);
  const port = await job.openSsh();
  const downloadPath = path.join(dir, `download_${randomUUID()}`);
  await scpDownloadDir(port, downloadPath, source);
  job.checkClient();
  const zipFile = path.join(dir, `${filePrefix}_${randomUUID()}.zip`);
  await zipDir(downloadPath, zipFile);
  job.checkClient();
  res.setHeader('Content-Disposition', `attachment; filename="${filePrefix}_${headerName(name)}.zip"`);
  res.setHeader('Content-Type', 'application/zip');
  const fileStream = fs.createReadStream(zipFile);
  job.onClientGone = () => fileStream.destroy();
  fileStream.on('error', () => res.destroy());
  fileStream.on('close', () => void job.finish(label));
  fileStream.pipe(res);
}
