import express from 'express';
import { HttpError, wrap } from '../lib/httpError';
import { requireAdmin } from '../middleware/permissions';
import { clearScopeCache } from '../customer/scope';
import { revokeRemoteKeys } from '../customer/sshKeys';
import { postgrestAsAdmin } from '../lib/postgrestAsAdmin';
import { hasCapability } from './capabilities';
import { listOpenBalenaUserIds } from './init';
import { getStore } from './store';

const router = express.Router();

const rowId = (v: unknown): number => {
  if (!Number.isInteger(v)) throw new Error('unexpected id in PostgREST response');
  return v as number;
};

// Serializes account changes per user so concurrent saves cannot interleave their sync steps.
const userLocks = new Map<number, Promise<unknown>>();
const withUserLock = async <T>(userId: number, fn: () => Promise<T>): Promise<T> => {
  const prev = userLocks.get(userId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  userLocks.set(userId, tail);
  try {
    return await run;
  } finally {
    if (userLocks.get(userId) === tail) userLocks.delete(userId);
  }
};

// Single place to change which openBalena role customer users get.
export const CUSTOMER_OPENBALENA_ROLE = 'default-user';
const MEMBERSHIP = 'organization membership';
const ORG_FIELD = 'is member of-organization';

const idParam = (v: unknown, what: string) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, `${what} not found`);
  return id;
};

// Best-effort: a balena API outage must not block permission management.
const pruneDeletedUsers = async () => {
  try {
    getStore().pruneUsers(await listOpenBalenaUserIds());
  } catch (error) {
    console.error(`[permissions] prune skipped: ${(error as Error).message}`);
  }
};

// Best-effort: losing device.terminal must remove the registered remote key, but a balena outage must not fail the change.
const revokeKeysSafely = async (adminAuth: string | undefined, userIds: number[]) => {
  for (const id of userIds) {
    try {
      await revokeRemoteKeys(id, adminAuth);
    } catch (error) {
      console.error(`[permissions] remote key revoke failed for user ${id}: ${(error as Error).message}`);
    }
  }
};

router.get(
  '/api/admin/permission-sets',
  ...requireAdmin,
  wrap(async (_req, res) => {
    const data = getStore().listSets();
    res.json({ data, total: data.length });
  }),
);

router.get(
  '/api/admin/permission-sets/:id',
  ...requireAdmin,
  wrap(async (req, res) => {
    const set = getStore().getSet(idParam(req.params.id, 'Permission set'));
    if (!set) throw new HttpError(404, 'Permission set not found');
    res.json(set);
  }),
);

router.post(
  '/api/admin/permission-sets',
  ...requireAdmin,
  wrap(async (req, res) => {
    const { name, description, capabilities } = req.body ?? {};
    res.json(getStore().createSet({ name, description, capabilities }));
  }),
);

router.put(
  '/api/admin/permission-sets/:id',
  ...requireAdmin,
  wrap(async (req, res) => {
    const { name, description, capabilities } = req.body ?? {};
    const id = idParam(req.params.id, 'Permission set');
    const store = getStore();
    const before = store.getSet(id);
    const updated = store.updateSet(id, { name, description, capabilities });
    if (
      before &&
      hasCapability(before.capabilities, 'device.terminal') &&
      !hasCapability(updated.capabilities, 'device.terminal')
    ) {
      await revokeKeysSafely(
        req.headers.authorization,
        store
          .listAssignments()
          .filter((a) => a.permissionSetId === id)
          .map((a) => a.userId),
      );
    }
    res.json(updated);
  }),
);

router.delete(
  '/api/admin/permission-sets/:id',
  ...requireAdmin,
  wrap(async (req, res) => {
    const id = idParam(req.params.id, 'Permission set');
    getStore().deleteSet(id);
    res.json({ id });
  }),
);

router.get(
  '/api/admin/users/:id/permission-set',
  ...requireAdmin,
  wrap(async (req, res) => {
    const userId = idParam(req.params.id, 'User');
    res.json({ userId, permissionSetId: getStore().getUserSet(userId)?.id ?? null });
  }),
);

router.put(
  '/api/admin/users/:id/permission-set',
  ...requireAdmin,
  wrap(async (req, res) => {
    const userId = idParam(req.params.id, 'User');
    const setId = req.body?.permissionSetId;
    if (setId !== null && !(typeof setId === 'number' && Number.isInteger(setId))) {
      throw new HttpError(400, 'permissionSetId must be a number or null');
    }
    await withUserLock(userId, async () => {
      await pruneDeletedUsers();
      const store = getStore();
      store.assignUser(userId, setId);
      clearScopeCache();
      const caps = store.getUserSet(userId)?.capabilities ?? [];
      if (!hasCapability(caps, 'device.terminal')) await revokeKeysSafely(req.headers.authorization, [userId]);
    });
    res.json({ userId, permissionSetId: setId });
  }),
);

router.get(
  '/api/admin/permission-assignments',
  ...requireAdmin,
  wrap(async (_req, res) => {
    await pruneDeletedUsers();
    res.json({ data: getStore().listAssignments() });
  }),
);

// Runs one sync step; any failure becomes a 502 naming the step.
const step = async <T>(name: string, fn: () => Promise<T>, note = ''): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    throw new HttpError(502, `openBalena sync failed at step "${name}": ${(error as Error).message}${note}`);
  }
};

// Leaves the user a member of exactly orgId (adds before removing, so a failure never strands the user without one).
const syncMembership = async (auth: string | undefined, userId: number, orgId: number) => {
  const rows = await postgrestAsAdmin<{ id: number; [k: string]: unknown }[]>(
    auth,
    'GET',
    MEMBERSHIP,
    `user=eq.${userId}&select=id,${encodeURIComponent(`"${ORG_FIELD}"`)}`,
  );
  // Stale ones go first: a failure leaves no membership (no fleets) rather than two orgs.
  for (const r of rows.filter((x) => x[ORG_FIELD] !== orgId)) {
    await postgrestAsAdmin(auth, 'DELETE', MEMBERSHIP, `id=eq.${rowId(r.id)}`);
  }
  if (!rows.some((r) => r[ORG_FIELD] === orgId)) {
    await postgrestAsAdmin(auth, 'POST', MEMBERSHIP, '', { user: userId, [ORG_FIELD]: orgId });
  }
};

// Leaves the user holding exactly the customer role.
const syncRole = async (auth: string | undefined, userId: number) => {
  const [role] = await postgrestAsAdmin<{ id: number }[]>(
    auth,
    'GET',
    'role',
    `name=eq.${encodeURIComponent(CUSTOMER_OPENBALENA_ROLE)}&select=id`,
  );
  if (!role) throw new Error(`role ${CUSTOMER_OPENBALENA_ROLE} not found`);
  const rows = await postgrestAsAdmin<{ id: number; role: number }[]>(auth, 'GET', 'user-has-role', `user=eq.${userId}&select=id,role`);
  if (!rows.some((r) => r.role === role.id)) {
    await postgrestAsAdmin(auth, 'POST', 'user-has-role', '', { user: userId, role: role.id });
  }
  for (const r of rows.filter((x) => x.role !== role.id)) {
    await postgrestAsAdmin(auth, 'DELETE', 'user-has-role', `id=eq.${rowId(r.id)}`);
  }
};

// Removes every direct openBalena permission so the admin UI store is the only source of capabilities.
const clearDirectPermissions = async (auth: string | undefined, userId: number) => {
  const rows = await postgrestAsAdmin<{ id: number }[]>(auth, 'GET', 'user-has-permission', `user=eq.${userId}&select=id`);
  for (const r of rows) {
    await postgrestAsAdmin(auth, 'DELETE', 'user-has-permission', `id=eq.${rowId(r.id)}`);
  }
};

const accountOf = (userId: number) => {
  const store = getStore();
  const orgId = store.getUserCustomerOrg(userId);
  if (orgId !== undefined) {
    return { type: 'customer' as const, orgId, effectivePermissionSetId: store.getUserSet(userId)?.id ?? null };
  }
  return { type: 'internal' as const, permissionSetId: store.getUserSet(userId)?.id ?? null };
};

router.get(
  '/api/admin/org-settings',
  ...requireAdmin,
  wrap(async (_req, res) => {
    res.json({ data: getStore().listOrgSettings() });
  }),
);

router.get(
  '/api/admin/orgs/:id/settings',
  ...requireAdmin,
  wrap(async (req, res) => {
    res.json(getStore().getOrgSettings(idParam(req.params.id, 'Organization')));
  }),
);

router.put(
  '/api/admin/orgs/:id/settings',
  ...requireAdmin,
  wrap(async (req, res) => {
    const orgId = idParam(req.params.id, 'Organization');
    const store = getStore();
    const before = store.getOrgSettings(orgId);
    const beforeSet = before.permissionSetId === null ? undefined : store.getSet(before.permissionSetId);
    // A legacy isCustomer field is ignored: an org is a customer org iff it has a permission set.
    const { permissionSetId } = req.body ?? {};
    const updated = store.setOrgSettings(orgId, { permissionSetId });
    clearScopeCache();
    const afterSet = updated.permissionSetId === null ? undefined : store.getSet(updated.permissionSetId);
    if (
      beforeSet &&
      hasCapability(beforeSet.capabilities, 'device.terminal') &&
      !hasCapability(afterSet?.capabilities ?? [], 'device.terminal')
    ) {
      await revokeKeysSafely(req.headers.authorization, store.listOrgUsers(orgId));
    }
    res.json(updated);
  }),
);

router.get(
  '/api/admin/users/:id/account',
  ...requireAdmin,
  wrap(async (req, res) => {
    res.json(accountOf(idParam(req.params.id, 'User')));
  }),
);

router.put(
  '/api/admin/users/:id/account',
  ...requireAdmin,
  wrap(async (req, res) => {
    const userId = idParam(req.params.id, 'User');
    await withUserLock(userId, async () => {
      const { type, orgId, permissionSetId } = req.body ?? {};
      const store = getStore();
      const auth = req.headers.authorization;
      if (type === 'internal') {
        if (permissionSetId !== null && !(typeof permissionSetId === 'number' && Number.isInteger(permissionSetId))) {
          throw new HttpError(400, 'permissionSetId must be a number or null');
        }
        await pruneDeletedUsers();
        store.assignUser(userId, permissionSetId);
      } else if (type === 'customer') {
        if (!(typeof orgId === 'number' && Number.isInteger(orgId) && orgId > 0)) {
          throw new HttpError(400, 'orgId must be a positive integer');
        }
        await pruneDeletedUsers();
        store.assertCanBeCustomer(userId, orgId);
        // Roles and permissions first: a failure there never leaves a moved membership.
        await step('user-has-role', () => syncRole(auth, userId));
        await step('user-has-permission', () => clearDirectPermissions(auth, userId), ' (roles were already updated; retrying is safe)');
        await step(MEMBERSHIP, () => syncMembership(auth, userId, orgId), ' (roles and permissions were already updated; retrying is safe)');
        try {
          store.setUserCustomer(userId, orgId);
        } catch (error) {
          throw new HttpError(
            error instanceof HttpError ? error.status : 500,
            `${(error as Error).message} (openBalena was updated, but the admin UI link was not saved; retrying is safe)`,
          );
        }
      } else {
        throw new HttpError(400, "type must be 'internal' or 'customer'");
      }
      clearScopeCache();
      if (!hasCapability(store.getUserSet(userId)?.capabilities ?? [], 'device.terminal')) {
        await revokeKeysSafely(auth, [userId]);
      }
    });
    res.json(accountOf(userId));
  }),
);

export default router;
