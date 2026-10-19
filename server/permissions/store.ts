import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError } from '../lib/httpError';
import { Capability, normalizeCapabilities } from './capabilities';

// Loaded at runtime so neither Vite nor ncc try to resolve the builtin.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

export type PermissionSet = {
  id: number;
  name: string;
  description: string;
  capabilities: Capability[];
  builtin: boolean;
};

export type Assignment = { userId: number; type: 'internal' | 'customer'; permissionSetId: number | null; orgId: number | null };
export type OrgSettings = { orgId: number; isCustomer: boolean; permissionSetId: number | null; userCount: number };

export type PermissionSetInput = { name?: unknown; description?: unknown; capabilities?: unknown };

export interface PermissionStore {
  isSeeded(): boolean;
  markSeeded(): void;
  transaction<T>(fn: () => T): T;
  listSets(): PermissionSet[];
  getSet(id: number): PermissionSet | undefined;
  createSet(input: PermissionSetInput, opts?: { builtin?: boolean }): PermissionSet;
  updateSet(id: number, input: PermissionSetInput): PermissionSet;
  deleteSet(id: number): void;
  /** Effective set: the org's set for a customer user (none if the org no longer qualifies), else the explicit one. */
  getUserSet(userId: number): PermissionSet | undefined;
  assignUser(userId: number, permissionSetId: number | null): void;
  getUserCustomerOrg(userId: number): number | undefined;
  assertCanBeCustomer(userId: number, orgId: number): void;
  setUserCustomer(userId: number, orgId: number): void;
  listAssignments(): Assignment[];
  getOrgSettings(orgId: number): OrgSettings;
  listOrgSettings(): OrgSettings[];
  setOrgSettings(orgId: number, input: { permissionSetId?: unknown }): OrgSettings;
  listOrgUsers(orgId: number): number[];
  pruneUsers(existingUserIds: number[]): void;
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS permission_set (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    description  TEXT NOT NULL DEFAULT '',
    capabilities TEXT NOT NULL,
    builtin      INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS user_permission_set (
    user_id           INTEGER PRIMARY KEY,
    permission_set_id INTEGER NOT NULL REFERENCES permission_set(id)
  );
  CREATE TABLE IF NOT EXISTS org_settings (
    org_id            INTEGER PRIMARY KEY,
    is_customer       INTEGER NOT NULL,
    permission_set_id INTEGER REFERENCES permission_set(id)
  );
  CREATE TABLE IF NOT EXISTS user_customer (
    user_id INTEGER PRIMARY KEY,
    org_id  INTEGER NOT NULL
  );
`;

type Row = { id: number; name: string; description: string; capabilities: string; builtin: number };

const toSet = (r: Row): PermissionSet => ({
  id: r.id,
  name: r.name,
  description: r.description,
  capabilities: JSON.parse(r.capabilities) as Capability[],
  builtin: r.builtin === 1,
});

const validName = (name: unknown): string => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    throw new HttpError(400, 'name must be 1-100 characters');
  }
  return name.trim();
};

const validDescription = (d: unknown): string => {
  if (d === undefined || d === null) return '';
  if (typeof d !== 'string' || d.length > 500) throw new HttpError(400, 'description must be at most 500 characters');
  return d;
};

export function openStore(path: string): PermissionStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  const getSet = (id: number) => {
    const r = db.prepare('SELECT * FROM permission_set WHERE id = ?').get(id) as Row | undefined;
    return r && toSet(r);
  };
  const requireSet = (id: number) => {
    const s = getSet(id);
    if (!s) throw new HttpError(404, 'Permission set not found');
    return s;
  };
  const nameTaken = (name: string, exceptId = -1) =>
    db.prepare('SELECT 1 FROM permission_set WHERE name = ? AND id != ?').get(name, exceptId) !== undefined;
  const getExplicitSet = (userId: number) => {
    const r = db
      .prepare(
        'SELECT ps.* FROM user_permission_set ups JOIN permission_set ps ON ps.id = ups.permission_set_id WHERE ups.user_id = ?',
      )
      .get(userId) as Row | undefined;
    return r && toSet(r);
  };
  const getUserCustomerOrg = (userId: number) =>
    (db.prepare('SELECT org_id FROM user_customer WHERE user_id = ?').get(userId) as { org_id: number } | undefined)
      ?.org_id;
  // A customer user never falls back to an explicit set: an org without a set means no access.
  const getUserSet = (userId: number) => {
    if (getUserCustomerOrg(userId) === undefined) return getExplicitSet(userId);
    const r = db
      .prepare(
        `SELECT ps.* FROM user_customer uc
         JOIN org_settings os ON os.org_id = uc.org_id
         JOIN permission_set ps ON ps.id = os.permission_set_id
         WHERE uc.user_id = ?`,
      )
      .get(userId) as Row | undefined;
    return r && toSet(r);
  };
  // Runs fn in a transaction unless one is already open.
  const atomic = <T>(fn: () => T): T => (db.isTransaction ? fn() : store.transaction(fn));
  const orgUsers = (orgId: number) =>
    (db.prepare('SELECT user_id FROM user_customer WHERE org_id = ? ORDER BY user_id').all(orgId) as { user_id: number }[]).map(
      (r) => r.user_id,
    );
  const getOrgSettings = (orgId: number): OrgSettings => {
    const r = db.prepare('SELECT * FROM org_settings WHERE org_id = ?').get(orgId) as
      | { permission_set_id: number | null }
      | undefined;
    const permissionSetId = r?.permission_set_id ?? null;
    return {
      orgId,
      isCustomer: permissionSetId !== null,
      permissionSetId,
      userCount: orgUsers(orgId).length,
    };
  };
  const listOrgSettings = (): OrgSettings[] =>
    (db.prepare('SELECT org_id FROM org_settings ORDER BY org_id').all() as { org_id: number }[]).map((r) =>
      getOrgSettings(r.org_id),
    );
  const orgSetOrThrow = (orgId: number): PermissionSet => {
    const o = getOrgSettings(orgId);
    const set = o.permissionSetId !== null ? getSet(o.permissionSetId) : undefined;
    if (!set) throw new HttpError(400, 'Org has no customer permission set');
    return set;
  };
  const checkLastAdmin = (userId: number) => {
    if (getExplicitSet(userId)?.capabilities.includes('admin') && adminUserCount() <= 1) {
      throw new HttpError(409, 'Cannot remove the last admin');
    }
  };
  const adminUserCount = () =>
    (
      db
        .prepare(
          'SELECT ps.capabilities FROM user_permission_set ups JOIN permission_set ps ON ps.id = ups.permission_set_id',
        )
        .all() as { capabilities: string }[]
    ).filter((r) => (JSON.parse(r.capabilities) as string[]).includes('admin')).length;

  const store: PermissionStore = {
    isSeeded: () => db.prepare("SELECT 1 FROM meta WHERE key = 'seeded'").get() !== undefined,
    markSeeded: () => {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded', ?)").run(new Date().toISOString());
    },
    transaction<T>(fn: () => T): T {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    listSets: () => (db.prepare('SELECT * FROM permission_set ORDER BY builtin DESC, name').all() as Row[]).map(toSet),
    getSet,
    createSet(input, opts = {}) {
      const name = validName(input.name);
      const description = validDescription(input.description);
      const caps = normalizeCapabilities(input.capabilities);
      if (nameTaken(name)) throw new HttpError(409, 'Name already in use');
      const r = db
        .prepare('INSERT INTO permission_set (name, description, capabilities, builtin) VALUES (?, ?, ?, ?)')
        .run(name, description, JSON.stringify(caps), opts.builtin ? 1 : 0);
      return requireSet(Number(r.lastInsertRowid));
    },
    updateSet(id, input) {
      const current = requireSet(id);
      if (current.builtin) throw new HttpError(409, 'Built-in permission sets cannot be changed');
      const name = input.name === undefined ? current.name : validName(input.name);
      if (nameTaken(name, id)) throw new HttpError(409, 'Name already in use');
      const description = input.description === undefined ? current.description : validDescription(input.description);
      const caps = input.capabilities === undefined ? current.capabilities : normalizeCapabilities(input.capabilities);
      if (caps.includes('admin') && !current.capabilities.includes('admin')) {
        const orgs = db.prepare('SELECT COUNT(*) AS n FROM org_settings WHERE permission_set_id = ?').get(id) as { n: number };
        if (orgs.n > 0) throw new HttpError(409, 'An organization cannot use an admin permission set');
      }
      if (current.capabilities.includes('admin') && !caps.includes('admin')) {
        const holders = db
          .prepare('SELECT COUNT(*) AS n FROM user_permission_set WHERE permission_set_id = ?')
          .get(id) as { n: number };
        if (holders.n > 0 && adminUserCount() - holders.n < 1) throw new HttpError(409, 'Cannot remove the last admin');
      }
      db.prepare('UPDATE permission_set SET name = ?, description = ?, capabilities = ? WHERE id = ?').run(
        name,
        description,
        JSON.stringify(caps),
        id,
      );
      return requireSet(id);
    },
    deleteSet(id) {
      const s = requireSet(id);
      if (s.builtin) throw new HttpError(409, 'Built-in permission sets cannot be deleted');
      const used = db
        .prepare('SELECT COUNT(*) AS n FROM user_permission_set WHERE permission_set_id = ?')
        .get(id) as { n: number };
      if (used.n > 0) throw new HttpError(409, 'Permission set is still assigned to users');
      const orgs = db.prepare('SELECT COUNT(*) AS n FROM org_settings WHERE permission_set_id = ?').get(id) as { n: number };
      if (orgs.n > 0) throw new HttpError(409, 'Permission set is still used by organizations');
      db.prepare('DELETE FROM permission_set WHERE id = ?').run(id);
    },
    getUserSet,
    assignUser(userId, permissionSetId) {
      const next = permissionSetId === null ? undefined : requireSet(permissionSetId);
      const current = getExplicitSet(userId);
      const losesAdmin = current?.capabilities.includes('admin') && !next?.capabilities.includes('admin');
      if (losesAdmin && adminUserCount() <= 1) throw new HttpError(409, 'Cannot remove the last admin');
      atomic(() => {
        db.prepare('DELETE FROM user_customer WHERE user_id = ?').run(userId);
        if (!next) {
          db.prepare('DELETE FROM user_permission_set WHERE user_id = ?').run(userId);
          return;
        }
        db.prepare(
          `INSERT INTO user_permission_set (user_id, permission_set_id) VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET permission_set_id = excluded.permission_set_id`,
        ).run(userId, next.id);
      });
    },
    getUserCustomerOrg,
    assertCanBeCustomer(userId, orgId) {
      orgSetOrThrow(orgId);
      checkLastAdmin(userId);
    },
    setUserCustomer(userId, orgId) {
      orgSetOrThrow(orgId);
      checkLastAdmin(userId);
      atomic(() => {
        db.prepare('DELETE FROM user_permission_set WHERE user_id = ?').run(userId);
        db.prepare(
          `INSERT INTO user_customer (user_id, org_id) VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET org_id = excluded.org_id`,
        ).run(userId, orgId);
      });
    },
    listAssignments() {
      const explicit = db.prepare('SELECT user_id, permission_set_id FROM user_permission_set').all() as {
        user_id: number;
        permission_set_id: number;
      }[];
      const rows: Assignment[] = explicit.map((r) => ({
        userId: r.user_id,
        type: 'internal',
        permissionSetId: r.permission_set_id,
        orgId: null,
      }));
      const customers = db.prepare('SELECT user_id, org_id FROM user_customer').all() as { user_id: number; org_id: number }[];
      for (const c of customers) {
        rows.push({ userId: c.user_id, type: 'customer', permissionSetId: getUserSet(c.user_id)?.id ?? null, orgId: c.org_id });
      }
      return rows.sort((a, b) => a.userId - b.userId);
    },
    getOrgSettings,
    listOrgSettings,
    setOrgSettings(orgId, input) {
      const { permissionSetId } = input;
      if (permissionSetId !== null && !(typeof permissionSetId === 'number' && Number.isInteger(permissionSetId))) {
        throw new HttpError(400, 'permissionSetId must be a number or null');
      }
      const linked = orgUsers(orgId).length;
      if (linked > 0 && permissionSetId === null) {
        throw new HttpError(409, `Organization still has ${linked} linked user(s)`);
      }
      if (permissionSetId !== null) {
        const set = getSet(permissionSetId);
        if (!set) throw new HttpError(400, 'Permission set not found');
        if (set.capabilities.includes('admin')) throw new HttpError(400, 'An organization cannot use an admin permission set');
      }
      db.prepare(
        `INSERT INTO org_settings (org_id, is_customer, permission_set_id) VALUES (?, ?, ?)
         ON CONFLICT(org_id) DO UPDATE SET is_customer = excluded.is_customer, permission_set_id = excluded.permission_set_id`,
      ).run(orgId, permissionSetId === null ? 0 : 1, permissionSetId);
      return getOrgSettings(orgId);
    },
    listOrgUsers: orgUsers,
    pruneUsers(existingUserIds) {
      // An empty user list is never trusted as "no users exist"; keep all assignments.
      if (existingUserIds.length === 0) return;
      const keep = new Set(existingUserIds);
      for (const c of db.prepare('SELECT user_id FROM user_customer').all() as { user_id: number }[]) {
        if (!keep.has(c.user_id)) db.prepare('DELETE FROM user_customer WHERE user_id = ?').run(c.user_id);
      }
      const rows = store.listAssignments().filter((a) => a.type === 'internal') as (Assignment & { permissionSetId: number })[];
      const isAdminRow = (permissionSetId: number) => getSet(permissionSetId)?.capabilities.includes('admin') === true;
      const stale = rows.filter((a) => !keep.has(a.userId));
      // Stale admin rows are spared unless a live admin remains, so the last admin cannot be pruned away.
      const liveAdminRemains = rows.some((a) => keep.has(a.userId) && isAdminRow(a.permissionSetId));
      for (const a of stale) {
        if (!liveAdminRemains && isAdminRow(a.permissionSetId)) continue;
        db.prepare('DELETE FROM user_permission_set WHERE user_id = ?').run(a.userId);
      }
    },
  };
  return store;
}

let current: PermissionStore | undefined;

export function setStore(store: PermissionStore): void {
  current = store;
}

export function getStore(): PermissionStore {
  if (!current) throw new HttpError(503, 'Permission store not initialised');
  return current;
}
