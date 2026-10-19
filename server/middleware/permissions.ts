import type { RequestHandler } from 'express';
import { sendError } from '../lib/httpError';
import { Capability, hasCapability } from '../permissions/capabilities';
import { getStore } from '../permissions/store';
import authorize from './authorize';

export const loadPermissions: RequestHandler = (req, res, next) => {
  try {
    // getUserSet resolves the effective set (org set for customer users).
    const set = getStore().getUserSet(req.user!.id);
    if (!set) {
      res.status(403).json({ success: false, message: 'No permission set assigned' });
      return;
    }
    req.capabilities = set.capabilities;
    req.permissionSet = { id: set.id, name: set.name };
    next();
  } catch (error) {
    sendError(res, error);
  }
};

export function requireCapability(cap: Capability): RequestHandler[] {
  const check: RequestHandler = (req, res, next) => {
    if (hasCapability(req.capabilities ?? [], cap)) {
      next();
      return;
    }
    res.status(403).json({ success: false, message: `Missing capability ${cap}` });
  };
  return [authorize, loadPermissions, check];
}

export const requireAdmin: RequestHandler[] = requireCapability('admin');
