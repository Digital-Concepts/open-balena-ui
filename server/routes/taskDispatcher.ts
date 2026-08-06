import express, { Request, Response } from 'express';
import { authorize, dosProtect } from '../middleware';

const router = express.Router();

const base = () => process.env.TASK_DISPATCHER_URL || 'http://task-dispatcher:7000';
const token = () => process.env.TASK_DISPATCHER_TOKEN;

async function proxy(
  req: Request,
  res: Response,
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: boolean } = {},
) {
  const t = token();
  if (!t) return res.status(500).json({ success: false, message: 'TASK_DISPATCHER_TOKEN not configured' });
  try {
    const url = `${base()}${path}`;
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${t}` } };
    if (opts.body) {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      init.body = JSON.stringify(req.body ?? {});
    }
    const r = await fetch(url, init);
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message });
  }
}

// Browser -> BFF -> task-dispatcher. The operator token is injected here and
// never reaches the browser. The forwarded body carries { name, device_name };
// the task-dispatcher parses the device name (EURID-SERIALNUMBER) to resolve
// the gateway and validates the task name.
//
// Path is under /task-dispatcher/, NOT /task/: host nginx proxies /task/ to the
// task-dispatcher's device channel (:7000), so a /task/* path here would be
// shadowed. /task-dispatcher/* falls through nginx's `location /` to this BFF.
router.post('/task-dispatcher/command', ...dosProtect, authorize, (req, res) =>
  proxy(req, res, 'POST', '/task/admin/tasks', { body: true }));

export default router;
