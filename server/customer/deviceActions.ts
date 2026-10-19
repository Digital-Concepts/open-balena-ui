import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import fs from 'node:fs';
import multer from 'multer';
import { HttpError, sendError, wrap } from '../lib/httpError';
import dosProtect from '../middleware/dosProtect';
import { requireCapability } from '../middleware/permissions';
import { Capability } from '../permissions/capabilities';
import { audited } from '../audit/record';
import type { AuditAction } from '../audit/actions';
import { UPLOAD_ROOT, assertUuid, setLogLevel, setSshState, uniqueFileNames } from '../lib/deviceShell';
import { DeviceJob, parseUploads, shortName, streamLogs, streamZip, uploadFiles, userKey } from '../lib/deviceJob';
import { loadDeviceInScope } from './scope';

const router = express.Router();

const upload = multer({ dest: `${UPLOAD_ROOT}/`, limits: { files: 20, fileSize: 100 * 1024 * 1024, fields: 5, parts: 25 } });

const LOG_LEVELS = new Set(['info', 'debug']);

const tokenOf = (req: Request): string => (req.headers.authorization || '').split('Bearer ')[1] || '';

/** The gateway config password is the device name, taken from the device record. */
type Target = { uuid: string; name: string };

async function targetOf(req: Request): Promise<Target> {
  const device = await loadDeviceInScope(req);
  return { uuid: assertUuid(device.uuid), name: String(device.device_name ?? '') };
}

/** Runs a one-shot gateway action with a job that always cleans up. */
function gatewayAction(
  cap: Capability,
  action: AuditAction,
  failure: string,
  run: (job: DeviceJob, target: Target, dir: string, req: Request) => Promise<void>,
  validate?: (req: Request) => void,
): RequestHandler[] {
  return [
    ...dosProtect,
    ...requireCapability(cap),
    audited(action),
    wrap(async (req, res) => {
      const target = await targetOf(req);
      validate?.(req);
      const job = new DeviceJob(target.uuid, target.name, res, userKey(req));
      if (!job.reserve()) return;
      try {
        const dir = await job.login(tokenOf(req));
        await run(job, target, dir, req);
        res.json({ success: true });
      } catch (error) {
        if (error instanceof HttpError && error.status < 500) job.fail(error.status, { error: error.message });
        else job.fail(500, { error: failure }, error);
      } finally {
        await job.finish(failure);
      }
    }),
  ];
}

router.post(
  '/api/customer/devices/:uuid/ssh',
  ...gatewayAction(
    'device.ssh',
    'ssh.set',
    'An error occurred while changing SSH status',
    async (job, target, dir, req) => {
      await setSshState(target.uuid, target.name, req.body.state, dir);
    },
    (req) => {
      if (req.body?.state !== 'on' && req.body?.state !== 'off') throw new HttpError(400, 'Invalid SSH state');
      req.auditDetails = { state: req.body.state };
    },
  ),
);

router.post(
  '/api/customer/devices/:uuid/log-level',
  ...gatewayAction(
    'device.loglevel',
    'loglevel.set',
    'An error occurred while changing log level',
    async (job, target, dir, req) => {
      await setLogLevel(target.uuid, target.name, req.body.logLevels, dir);
    },
    (req) => {
      if (typeof req.body?.logLevels !== 'string' || !LOG_LEVELS.has(req.body.logLevels)) {
        throw new HttpError(400, 'Invalid log level');
      }
      req.auditDetails = { logLevels: req.body.logLevels };
    },
  ),
);

/** Resolves the in-scope device and takes a job slot before multer touches the body; 403/429 never parse an upload. */
const scopeGuard: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  targetOf(req).then(
    (target) => {
      const job = new DeviceJob(target.uuid, target.name, res, userKey(req));
      if (!job.reserve()) return;
      res.locals.target = target;
      res.locals.job = job;
      next();
    },
    (error) => sendError(res, error),
  );
};

const parseUpload = parseUploads(upload.array('files', 20));

router.post(
  '/api/customer/devices/:uuid/files',
  ...dosProtect,
  ...requireCapability('device.files'),
  audited('files.upload'),
  scopeGuard,
  parseUpload,
  async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    const removeUploads = () => files.forEach((f) => fs.rmSync(f.path, { force: true }));
    const job: DeviceJob = res.locals.job;
    if (!files.length) {
      res.status(400).json({ error: 'No files' });
      return;
    }
    let remoteNames: string[];
    try {
      remoteNames = uniqueFileNames(files.map((f) => f.originalname));
      req.auditDetails = { count: remoteNames.length, names: remoteNames };
    } catch {
      removeUploads();
      res.status(400).json({ error: 'Invalid file name' });
      return;
    }
    try {
      await uploadFiles(job, tokenOf(req), files, remoteNames);
      res.json({ success: true });
    } catch (error) {
      job.fail(500, { error: 'An error occurred while transferring files' }, error);
    } finally {
      removeUploads();
      void job.finish('upload');
    }
  },
);

router.post(
  '/api/customer/devices/:uuid/files/download',
  ...dosProtect,
  ...requireCapability('device.files'),
  audited('files.download', { stream: true }),
  wrap(async (req, res) => {
    const target = await targetOf(req);
    const job = new DeviceJob(target.uuid, target.name, res, userKey(req));
    if (!job.reserve()) return;
    try {
      await streamZip(job, res, tokenOf(req), 'outbound', 'outbound', shortName(target.name, target.uuid), 'download');
    } catch (error) {
      job.fail(500, { error: 'An error occurred while downloading files' }, error);
      void job.finish('download');
    }
  }),
);

router.post(
  '/api/customer/devices/:uuid/logs/download',
  ...dosProtect,
  ...requireCapability('device.logs.download'),
  audited('logs.download', { stream: true }),
  wrap(async (req, res) => {
    const target = await targetOf(req);
    const job = new DeviceJob(target.uuid, target.name, res, userKey(req));
    if (!job.reserve()) return;
    try {
      await streamLogs(job, res, tokenOf(req), shortName(target.name, target.uuid));
    } catch (error) {
      job.fail(500, { error: 'An error occurred while downloading logs' }, error);
      void job.finish('logs');
    }
  }),
);

export default router;
