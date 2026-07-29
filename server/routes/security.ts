import express, { Request, Response } from 'express';
import { authorize, dosProtect } from '../middleware';

const router = express.Router();

const base = () => process.env.SECURITY_URL || 'http://security-apparatus:7100';
const token = () => process.env.SECURITY_TOKEN;

async function proxy(
  req: Request,
  res: Response,
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  opts: { query?: boolean; body?: boolean; text?: boolean; contentType?: string } = {},
) {
  const t = token();
  if (!t) return res.status(500).json({ success: false, message: 'SECURITY_TOKEN not configured' });
  try {
    let url = `${base()}${path}`;
    if (opts.query) {
      const qp = new URLSearchParams();
      for (const k of ['type', 'since', 'limit']) {
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
      return res.status(r.status).type(opts.contentType || 'text/plain').send(text);
    }
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message });
  }
}

router.get('/security/status', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/status'));
router.get('/security/config', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/config'));
router.put('/security/config', ...dosProtect, authorize, (req, res) => proxy(req, res, 'PUT', '/config', { body: true }));
router.post('/security/run', ...dosProtect, authorize, (req, res) => proxy(req, res, 'POST', '/run', { body: true }));
router.get('/security/runs', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/runs'));
// Declared before the :id route so the literal path wins in Express order.
router.get('/security/runs/latest', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/runs/latest'));
router.get('/security/runs/:id', ...dosProtect, authorize, (req, res) =>
  proxy(req, res, 'GET', `/runs/${encodeURIComponent(req.params.id)}`));
router.get('/security/runs/:id/log', ...dosProtect, authorize, (req, res) =>
  proxy(req, res, 'GET', `/runs/${encodeURIComponent(req.params.id)}/log`, { text: true }));
router.get('/security/runs/:id/sbom/:name', ...dosProtect, authorize, (req, res) =>
  proxy(req, res, 'GET', `/runs/${encodeURIComponent(req.params.id)}/sbom/${encodeURIComponent(req.params.name)}`,
    { text: true, contentType: 'application/json' }));
router.get('/security/audit', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/audit', { query: true }));

// Fleet SBOM/CVE reports (uploaded by the build system). Read-only from the UI.
router.get('/security/fleets', ...dosProtect, authorize, (req, res) => proxy(req, res, 'GET', '/fleets'));
router.get('/security/fleets/:fleet/releases', ...dosProtect, authorize, (req, res) =>
  proxy(req, res, 'GET', `/fleets/${encodeURIComponent(req.params.fleet)}/releases`));
router.get('/security/fleets/:fleet/releases/:release', ...dosProtect, authorize, (req, res) =>
  proxy(req, res, 'GET',
    `/fleets/${encodeURIComponent(req.params.fleet)}/releases/${encodeURIComponent(req.params.release)}`));
router.get('/security/fleets/:fleet/releases/:release/sbom/:service', ...dosProtect, authorize, (req, res) =>
  proxy(req, res, 'GET',
    `/fleets/${encodeURIComponent(req.params.fleet)}/releases/${encodeURIComponent(req.params.release)}` +
    `/sbom/${encodeURIComponent(req.params.service)}`,
    { text: true, contentType: 'application/json' }));

export default router;
