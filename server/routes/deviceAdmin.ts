import express, { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import multer from 'multer';
import jwt from 'njwt';
import { requireAdmin } from '../middleware';
import { HttpError } from '../lib/httpError';
import {
  HOST_SSH_PORT,
  UPLOAD_ROOT,
  isValidUuid,
  openTunnel,
  setLogLevel,
  setSshState,
  sshRun,
  uniqueFileNames,
} from '../lib/deviceShell';
import {
  BUSY_USER,
  DeviceJob,
  parseUploads,
  streamLogs,
  streamZip,
  uploadFiles,
  userAtLimit,
  userKey,
} from '../lib/deviceJob';
import type { DownloadSource } from '../lib/deviceShell';

const router = express.Router();
// File count and size stay unlimited for admins; field/part counts are capped.
const upload = multer({ dest: `${UPLOAD_ROOT}/`, limits: { fields: 5, parts: 25 } });

function extractToken(req: Request): string {
  const auth = req.headers.authorization || '';
  return auth.split('Bearer ')[1] || '';
}

function verifiedToken(req: Request): string {
  const token = extractToken(req);
  jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET as string);
  return token;
}

/** Sends 400 and returns false when the body uuid is not a device uuid. */
function checkUuid(uuid: unknown, res: Response): uuid is string {
  if (isValidUuid(uuid)) return true;
  res.status(400).json({ error: 'Invalid device uuid' });
  return false;
}

router.post('/download-logs', ...requireAdmin, async (req: Request, res: Response) => {
  const { uuid, name, configPassword } = req.body;
  if (!checkUuid(uuid, res)) return;
  const job = new DeviceJob(uuid, configPassword, res, userKey(req));
  if (!job.reserve()) return;
  try {
    await streamLogs(job, res, verifiedToken(req), name);
  } catch (error) {
    job.fail(500, { error: 'An error occurred while downloading logs' }, error);
    void job.finish('logs');
  }
});

router.post('/log-level', ...requireAdmin, async (req: Request, res: Response) => {
  const { uuid, password, logLevels } = req.body;
  if (!checkUuid(uuid, res)) return;
  const job = new DeviceJob(uuid, password, res, userKey(req));
  if (!job.reserve()) return;
  try {
    const dir = await job.login(verifiedToken(req));
    const responseData = await setLogLevel(uuid, password, logLevels, dir);
    res.json({ success: true, data: responseData });
  } catch (error) {
    if (error instanceof HttpError) job.fail(error.status, { error: error.message });
    else job.fail(500, { error: 'An error occurred while changing log level' }, error);
  } finally {
    await job.finish('log level');
  }
});

router.post('/control-ssh', ...requireAdmin, async (req: Request, res: Response) => {
  const { uuid, configPassword, status } = req.body;
  if (!checkUuid(uuid, res)) return;
  const job = new DeviceJob(uuid, configPassword, res, userKey(req));
  if (!job.reserve()) return;
  try {
    const dir = await job.login(verifiedToken(req));
    const responseData = await setSshState(uuid, configPassword, status, dir);
    res.json({ success: true, data: responseData });
  } catch (error) {
    if (error instanceof HttpError) job.fail(error.status, { error: error.message });
    else job.fail(500, { error: 'An error occurred while changing SSH status' }, error);
  } finally {
    await job.finish('ssh control');
  }
});

/** Refuses before multer writes anything when the user is already at the job limit. */
const userSlotGuard = (req: Request, res: Response, next: NextFunction) => {
  if (userAtLimit(userKey(req))) {
    res.status(429).json({ error: BUSY_USER });
    return;
  }
  next();
};

router.post('/send-files', ...requireAdmin, userSlotGuard, parseUploads(upload.array('files')), async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const removeUploads = () => files.forEach((f) => fs.rmSync(f.path, { force: true }));
  const { uuid, configPassword } = req.body;
  if (!checkUuid(uuid, res)) return removeUploads();
  if (!files.length) {
    res.status(400).json({ error: 'No files' });
    return;
  }
  let remoteNames: string[];
  try {
    remoteNames = uniqueFileNames(files.map((f) => f.originalname));
  } catch {
    removeUploads();
    res.status(400).json({ error: 'Invalid file name' });
    return;
  }
  const job = new DeviceJob(uuid, configPassword, res, userKey(req));
  if (!job.reserve()) return removeUploads();
  try {
    await uploadFiles(job, verifiedToken(req), files, remoteNames);
    res.json({ success: true, message: 'Files uploaded successfully' });
  } catch (error) {
    job.fail(500, { error: 'An error occurred while transferring files' }, error);
  } finally {
    removeUploads();
    void job.finish('upload');
  }
});

async function sendZip(req: Request, res: Response, source: DownloadSource, filePrefix: string, label: string) {
  const { uuid, name, configPassword } = req.body;
  if (!checkUuid(uuid, res)) return;
  const job = new DeviceJob(uuid, configPassword, res, userKey(req));
  if (!job.reserve()) return;
  try {
    await streamZip(job, res, verifiedToken(req), source, filePrefix, name, label);
  } catch (error) {
    job.fail(500, { error: 'An error occurred while downloading files' }, error);
    void job.finish(label);
  }
}

router.post('/download-files', ...requireAdmin, (req: Request, res: Response) =>
  sendZip(req, res, 'outbound', 'outbound', 'download'),
);

router.post('/download-backup', ...requireAdmin, (req: Request, res: Response) =>
  sendZip(req, res, 'backup', 'backup', 'backup'),
);

function lastLineOf(output: string): string {
  const lines = output.trim().split('\n');
  return lines[lines.length - 1];
}

const REMOTE_FAILED = 'Remote command failed';

router.post('/update-supervisor', ...requireAdmin, async (req: Request, res: Response) => {
  const { uuid } = req.body;
  if (!checkUuid(uuid, res)) return;
  const job = new DeviceJob(uuid, '', res, userKey(req));
  if (!job.reserve()) return;
  try {
    const dir = await job.login(verifiedToken(req));
    job.tunnel = await openTunnel(uuid, HOST_SSH_PORT, dir);
    const output = await sshRun(job.tunnel.tunnelPort, 'update-supervisor');
    res.json({ success: true, message: 'Update supervisor command sent', output, lastLine: lastLineOf(output) });
  } catch (error) {
    job.fail(500, { error: 'An error occurred while updating Supervisor', details: REMOTE_FAILED }, error);
  } finally {
    await job.finish('supervisor update');
  }
});

router.post('/upload-ionos', ...requireAdmin, async (req: Request, res: Response) => {
  const { uuid, configPassword } = req.body;
  if (!checkUuid(uuid, res)) return;
  const job = new DeviceJob(uuid, configPassword, res, userKey(req));
  if (!job.reserve()) return;
  try {
    await job.login(verifiedToken(req));
    const port = await job.openSsh();
    const output = await sshRun(port, 'ionos-backup');
    res.json({ success: true, message: 'Upload to Ionos command sent', output, lastLine: lastLineOf(output) });
  } catch (error) {
    job.fail(500, { error: 'An error occurred while uploading to Ionos', details: REMOTE_FAILED }, error);
  } finally {
    void job.finish('Ionos upload');
  }
});

export default router;
