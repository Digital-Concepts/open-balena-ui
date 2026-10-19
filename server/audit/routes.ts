import express from 'express';
import { HttpError, wrap } from '../lib/httpError';
import { requireAdmin } from '../middleware/permissions';
import { getStore } from '../permissions/store';
import { AUDIT_ACTIONS, AuditAction } from './actions';

const router = express.Router();

const intParam = (v: unknown, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined => {
  if (v === undefined) return undefined;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${name} must be an integer between ${min} and ${max === Number.MAX_SAFE_INTEGER ? 'max' : max}`);
  }
  return n;
};

router.get(
  '/api/admin/audit',
  ...requireAdmin,
  wrap(async (req, res) => {
    const { action } = req.query;
    if (action !== undefined && !(typeof action === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(action))) {
      throw new HttpError(400, 'action is not a known audit action');
    }
    res.json(
      getStore().listAudit({
        page: intParam(req.query.page, 'page', 1) ?? 1,
        perPage: intParam(req.query.perPage, 'perPage', 1, 200) ?? 25,
        userId: intParam(req.query.userId, 'userId', 1),
        fleetId: intParam(req.query.fleetId, 'fleetId', 1),
        action: action as AuditAction | undefined,
      }),
    );
  }),
);

router.get(
  '/api/admin/audit/filters',
  ...requireAdmin,
  wrap(async (_req, res) => {
    res.json(getStore().auditFilterValues());
  }),
);

export default router;
