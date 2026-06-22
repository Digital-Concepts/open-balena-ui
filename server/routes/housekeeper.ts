import express, { Request, Response } from 'express';
import { authorize, dosProtect } from '../middleware';

const router = express.Router();

const base = () => process.env.HOUSEKEEPER_URL || 'http://balena-housekeeper:7000';
const token = () => process.env.HOUSEKEEPER_TOKEN;

async function proxy(
  req: Request,
  res: Response,
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  opts: { query?: boolean; body?: boolean; text?: boolean } = {},
) {
  const t = token();
  if (!t) return res.status(500).json({ success: false, message: 'HOUSEKEEPER_TOKEN not configured' });
  try {
    let url = `${base()}${path}`;
    if (opts.query) {
      const qp = new URLSearchParams();
      for (const k of ['type', 'fleet', 'since', 'limit']) {
        if (req.query[k]) qp.append(k, String(req.query[k]));
      }
      if (qp.toString()) url += `?${qp.toString()}`;
    }
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${t}` } };
    if (opts.body) {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      init.body = JSON.stringify(req.body ?? {});
    }
    const r = await fetch(url, init);
    if (opts.text) {
      const text = await r.text();
      return res.status(r.status).type('text/plain').send(text);
    }
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message });
  }
}

router.get('/housekeeper/status', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/status'));
router.get('/housekeeper/config', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/config'));
router.put('/housekeeper/config', ...dosProtect, authorize, (req, res) => proxy(req, res, 'PUT', '/config', { body: true }));
router.get('/housekeeper/runs', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/runs'));
router.get('/housekeeper/runs/:id/log', ...dosProtect, authorize, (req, res) =>
  proxy(req, res, 'GET', `/runs/${encodeURIComponent(req.params.id)}/log`, { text: true }));
router.get('/housekeeper/audit', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/audit', { query: true }));
router.get('/housekeeper/fleets', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/fleets'));
router.post('/housekeeper/run', ...dosProtect, authorize, (req, res) => proxy(req, res, 'POST', '/run', { body: true }));

export default router;
