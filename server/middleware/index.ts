import authorize from './authorize';
import dosProtect from './dosProtect';
import { loadPermissions, requireAdmin, requireCapability } from './permissions';

export { authorize, dosProtect, loadPermissions, requireAdmin, requireCapability };

export default {
  authorize,
  dosProtect,
  loadPermissions,
  requireAdmin,
  requireCapability,
};
