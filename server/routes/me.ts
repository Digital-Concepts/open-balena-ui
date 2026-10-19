import express from 'express';
import authorize from '../middleware/authorize';
import { loadPermissions } from '../middleware/permissions';

const router = express.Router();

// No rate limit: the postgrest proxy calls this for every new admin token.
router.get('/api/me', authorize, loadPermissions, (req, res) => {
  res.json({ userId: req.user!.id, permissionSet: req.permissionSet, capabilities: req.capabilities });
});

export default router;
