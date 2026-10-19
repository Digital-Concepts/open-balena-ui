// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, PermissionStore } from '../store';
import { normalizeCapabilities, hasCapability, CUSTOMER_STANDARD } from '../capabilities';
import { HttpError } from '../../lib/httpError';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

let store: PermissionStore;
beforeEach(() => {
  store = openStore(':memory:');
});

const expectHttp = (fn: () => unknown, status: number) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(status);
    return;
  }
  throw new Error('expected HttpError');
};

describe('normalizeCapabilities', () => {
  it('adds device.read to any customer capability', () => {
    expect(normalizeCapabilities(['device.logs'])).toEqual(['device.read', 'device.logs']);
  });
  it('collapses anything containing admin to admin', () => {
    expect(normalizeCapabilities(['device.logs', 'admin'])).toEqual(['admin']);
  });
  it('rejects unknown and empty input', () => {
    expectHttp(() => normalizeCapabilities(['device.delete']), 400);
    expectHttp(() => normalizeCapabilities([]), 400);
    expectHttp(() => normalizeCapabilities('admin'), 400);
  });
  it('hasCapability lets admin through', () => {
    expect(hasCapability(['admin'], 'device.logs')).toBe(true);
    expect(hasCapability(['device.read'], 'device.logs')).toBe(false);
  });
});

describe('PermissionStore', () => {
  it('creates, lists, updates and deletes sets', () => {
    const s = store.createSet({ name: 'Std', capabilities: CUSTOMER_STANDARD });
    expect(store.listSets().map((x) => x.name)).toEqual(['Std']);
    const u = store.updateSet(s.id, { capabilities: ['device.logs'] });
    expect(u.capabilities).toEqual(['device.read', 'device.logs']);
    store.deleteSet(s.id);
    expect(store.listSets()).toEqual([]);
  });
  it('rejects duplicate names', () => {
    store.createSet({ name: 'A', capabilities: ['device.read'] });
    expectHttp(() => store.createSet({ name: 'A', capabilities: ['device.read'] }), 409);
  });
  it('builtin sets are immutable', () => {
    const a = store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true });
    expectHttp(() => store.updateSet(a.id, { name: 'X' }), 409);
    expectHttp(() => store.deleteSet(a.id), 409);
  });
  it('refuses to delete a set still assigned', () => {
    const s = store.createSet({ name: 'S', capabilities: ['device.read'] });
    store.assignUser(5, s.id);
    expectHttp(() => store.deleteSet(s.id), 409);
  });
  it('assigns, reassigns and unassigns users', () => {
    const a = store.createSet({ name: 'A', capabilities: ['device.read'] });
    const b = store.createSet({ name: 'B', capabilities: ['device.logs'] });
    store.assignUser(7, a.id);
    store.assignUser(7, b.id);
    expect(store.getUserSet(7)?.name).toBe('B');
    store.assignUser(7, null);
    expect(store.getUserSet(7)).toBeUndefined();
    expectHttp(() => store.assignUser(7, 999), 404);
  });
  it('refuses to remove the last admin', () => {
    const admin = store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true });
    const cust = store.createSet({ name: 'C', capabilities: ['device.read'] });
    store.assignUser(1, admin.id);
    expectHttp(() => store.assignUser(1, cust.id), 409);
    expectHttp(() => store.assignUser(1, null), 409);
    store.assignUser(2, admin.id);
    store.assignUser(1, cust.id);
    expect(store.getUserSet(1)?.name).toBe('C');
  });
  it('prunes assignments of users that no longer exist', () => {
    const s = store.createSet({ name: 'S', capabilities: ['device.read'] });
    store.assignUser(1, s.id);
    store.assignUser(2, s.id);
    store.pruneUsers([2]);
    expect(store.listAssignments()).toEqual([{ userId: 2, type: 'internal', permissionSetId: s.id, orgId: null }]);
  });
  it('pruneUsers with an empty list keeps every assignment', () => {
    const admin = store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true });
    store.assignUser(1, admin.id);
    store.pruneUsers([]);
    expect(store.listAssignments()).toEqual([{ userId: 1, type: 'internal', permissionSetId: admin.id, orgId: null }]);
  });
  it('pruneUsers with a live admin removes every stale row, admin or not', () => {
    const admin = store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true });
    const ro = store.createSet({ name: 'RO', capabilities: ['device.read'] });
    store.assignUser(1, admin.id);
    store.assignUser(42, admin.id);
    store.assignUser(8, ro.id);
    store.pruneUsers([1]);
    expect(store.listAssignments()).toEqual([{ userId: 1, type: 'internal', permissionSetId: admin.id, orgId: null }]);
  });
  it('pruneUsers without a live admin keeps stale admin rows', () => {
    const admin = store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true });
    const ro = store.createSet({ name: 'RO', capabilities: ['device.read'] });
    store.assignUser(1, admin.id);
    store.assignUser(42, admin.id);
    store.assignUser(5, ro.id);
    store.pruneUsers([5]);
    expect(store.listAssignments()).toEqual([
      { userId: 1, type: 'internal', permissionSetId: admin.id, orgId: null },
      { userId: 5, type: 'internal', permissionSetId: ro.id, orgId: null },
      { userId: 42, type: 'internal', permissionSetId: admin.id, orgId: null },
    ]);
  });
  it('updateSet refuses to strip admin from the only admin user', () => {
    const s = store.createSet({ name: 'Solo', capabilities: ['admin'] });
    store.assignUser(1, s.id);
    expectHttp(() => store.updateSet(s.id, { capabilities: ['device.read'] }), 409);
    expect(store.getSet(s.id)?.capabilities).toEqual(['admin']);
  });
  it('updateSet allows stripping admin when another admin user exists', () => {
    const s = store.createSet({ name: 'Solo', capabilities: ['admin'] });
    const other = store.createSet({ name: 'Other', capabilities: ['admin'] });
    store.assignUser(1, s.id);
    store.assignUser(2, other.id);
    const u = store.updateSet(s.id, { capabilities: ['device.read'] });
    expect(u.capabilities).toEqual(['device.read']);
  });
  it('updateSet refuses to strip admin when all admins hold this set', () => {
    const s = store.createSet({ name: 'Shared', capabilities: ['admin'] });
    store.assignUser(1, s.id);
    store.assignUser(2, s.id);
    expectHttp(() => store.updateSet(s.id, { capabilities: ['device.read'] }), 409);
  });
  it('tracks seeding and rolls back failed transactions', () => {
    expect(store.isSeeded()).toBe(false);
    expect(() =>
      store.transaction(() => {
        store.createSet({ name: 'T', capabilities: ['device.read'] });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.listSets()).toEqual([]);
    store.markSeeded();
    expect(store.isSeeded()).toBe(true);
  });
});

describe('customer users and org settings', () => {
  const customerOrg = (orgId = 10) => {
    const set = store.createSet({ name: `Cust${orgId}`, capabilities: ['device.read', 'device.logs'] });
    store.setOrgSettings(orgId, { permissionSetId: set.id });
    return set;
  };
  it('org settings default to non-customer with a user count', () => {
    expect(store.getOrgSettings(3)).toEqual({ orgId: 3, isCustomer: false, permissionSetId: null, userCount: 0 });
  });
  it('validates org settings', () => {
    expectHttp(() => store.setOrgSettings(3, {}), 400);
    expectHttp(() => store.setOrgSettings(3, { permissionSetId: 999 }), 400);
    const admin = store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true });
    expectHttp(() => store.setOrgSettings(3, { permissionSetId: admin.id }), 400);
  });
  it('resolves a customer user to the org set', () => {
    const set = customerOrg();
    store.setUserCustomer(7, 10);
    expect(store.getUserSet(7)?.id).toBe(set.id);
    expect(store.getOrgSettings(10).userCount).toBe(1);
  });
  it('an org is a customer org iff it has a permission set', () => {
    const set = customerOrg(4);
    expect(store.getOrgSettings(4)).toEqual({ orgId: 4, isCustomer: true, permissionSetId: set.id, userCount: 0 });
    store.setOrgSettings(4, { permissionSetId: null });
    expect(store.getOrgSettings(4)).toEqual({ orgId: 4, isCustomer: false, permissionSetId: null, userCount: 0 });
  });
  it('refuses clearing the set while users are linked', () => {
    const explicit = store.createSet({ name: 'Old', capabilities: ['device.read'] });
    store.assignUser(7, explicit.id);
    const set = customerOrg();
    store.setUserCustomer(7, 10);
    expectHttp(() => store.setOrgSettings(10, { permissionSetId: null }), 409);
    expect(store.getOrgSettings(10).permissionSetId).toBe(set.id);
  });
  it('fails closed when org settings are missing or have no set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perm-'));
    const path = join(dir, 'a.db');
    const file = openStore(path);
    const set = file.createSet({ name: 'X', capabilities: ['device.read'] });
    file.setOrgSettings(10, { permissionSetId: set.id });
    file.setUserCustomer(7, 10);
    const raw = new DatabaseSync(path);
    raw.exec('UPDATE org_settings SET permission_set_id = NULL');
    expect(file.getUserSet(7)).toBeUndefined();
    raw.exec('DELETE FROM org_settings');
    expect(file.getUserSet(7)).toBeUndefined();
    raw.close();
    rmSync(dir, { recursive: true });
  });
  it('setUserCustomer requires a customer org with a set and removes the explicit set', () => {
    expectHttp(() => store.setUserCustomer(7, 10), 400);
    const explicit = store.createSet({ name: 'Old', capabilities: ['device.read'] });
    store.assignUser(7, explicit.id);
    customerOrg();
    store.setUserCustomer(7, 10);
    expect(store.getUserCustomerOrg(7)).toBe(10);
    expect(store.listAssignments()).toEqual([
      { userId: 7, type: 'customer', permissionSetId: expect.any(Number), orgId: 10 },
    ]);
  });
  it('assignUser removes the customer link', () => {
    customerOrg();
    store.setUserCustomer(7, 10);
    const s = store.createSet({ name: 'In', capabilities: ['device.read'] });
    store.assignUser(7, s.id);
    expect(store.getUserCustomerOrg(7)).toBeUndefined();
    expect(store.getUserSet(7)?.id).toBe(s.id);
  });
  it('switching the last admin to customer is refused', () => {
    const admin = store.createSet({ name: 'Admin', capabilities: ['admin'] }, { builtin: true });
    store.assignUser(1, admin.id);
    customerOrg();
    expectHttp(() => store.setUserCustomer(1, 10), 409);
    expectHttp(() => store.assertCanBeCustomer(1, 10), 409);
    store.assignUser(2, admin.id);
    store.setUserCustomer(1, 10);
    expect(store.getUserCustomerOrg(1)).toBe(10);
  });
  it('refuses to grant admin to a set referenced by an org', () => {
    const set = customerOrg();
    expectHttp(() => store.updateSet(set.id, { capabilities: ['admin'] }), 409);
  });
  it('refuses to delete a set referenced by an org', () => {
    const set = customerOrg();
    expectHttp(() => store.deleteSet(set.id), 409);
  });
  it('prunes customer links of deleted users', () => {
    customerOrg();
    store.setUserCustomer(7, 10);
    store.setUserCustomer(8, 10);
    store.pruneUsers([8]);
    expect(store.listAssignments().map((a) => a.userId)).toEqual([8]);
  });
  it('lists the users linked to an org', () => {
    customerOrg();
    store.setUserCustomer(7, 10);
    expect(store.listOrgUsers(10)).toEqual([7]);
  });
});

describe('audit log', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    userId: 1,
    username: 'alice',
    orgId: 10,
    orgName: 'Org',
    fleetId: 100,
    fleetName: 'Fleet',
    deviceUuid: 'abc',
    deviceName: 'dev',
    action: 'device.reboot',
    result: 'ok' as const,
    ...over,
  });

  it('stores an entry and returns details parsed', () => {
    store.recordAudit(entry({ action: 'tag.create', details: { key: 'k' } }));
    const { data, total } = store.listAudit({ page: 1, perPage: 10 });
    expect(total).toBe(1);
    expect(data[0]).toMatchObject({ userId: 1, username: 'alice', action: 'tag.create', details: { key: 'k' }, result: 'ok', error: null });
    expect(typeof data[0].id).toBe('number');
    expect(new Date(data[0].ts).toISOString()).toBe(data[0].ts);
  });
  it('returns null details when none given', () => {
    store.recordAudit(entry());
    expect(store.listAudit({ page: 1, perPage: 10 }).data[0].details).toBeNull();
  });
  it('rejects an unknown result', () => {
    expect(() => store.recordAudit(entry({ result: 'aborted' }))).toThrow();
  });
  it('orders by ts then id, newest first, and pages', () => {
    store.recordAudit(entry({ ts: '2026-01-01T00:00:00.000Z', action: 'tag.create' }));
    store.recordAudit(entry({ ts: '2026-01-03T00:00:00.000Z', action: 'tag.update' }));
    store.recordAudit(entry({ ts: '2026-01-03T00:00:00.000Z', action: 'tag.delete' }));
    const all = store.listAudit({ page: 1, perPage: 10 });
    expect(all.data.map((r) => r.action)).toEqual(['tag.delete', 'tag.update', 'tag.create']);
    const p2 = store.listAudit({ page: 2, perPage: 2 });
    expect(p2.total).toBe(3);
    expect(p2.data.map((r) => r.action)).toEqual(['tag.create']);
  });
  it('filters by user, action and fleet, combined', () => {
    store.recordAudit(entry({ userId: 1, fleetId: 100, action: 'device.reboot' }));
    store.recordAudit(entry({ userId: 2, fleetId: 100, action: 'device.reboot' }));
    store.recordAudit(entry({ userId: 2, fleetId: 200, action: 'ssh.set' }));
    expect(store.listAudit({ page: 1, perPage: 10, userId: 2 }).total).toBe(2);
    expect(store.listAudit({ page: 1, perPage: 10, action: 'ssh.set' }).total).toBe(1);
    expect(store.listAudit({ page: 1, perPage: 10, fleetId: 100 }).total).toBe(2);
    expect(store.listAudit({ page: 1, perPage: 10, userId: 2, fleetId: 100, action: 'device.reboot' }).total).toBe(1);
  });
  it('lists filter values with the latest snapshot name', () => {
    store.recordAudit(entry({ ts: '2026-01-01T00:00:00.000Z', userId: 1, username: 'old', fleetId: 100, fleetName: 'F-old' }));
    store.recordAudit(entry({ ts: '2026-01-02T00:00:00.000Z', userId: 1, username: 'new', fleetId: 100, fleetName: 'F-new' }));
    store.recordAudit(entry({ ts: '2026-01-02T00:00:00.000Z', userId: 2, username: null, fleetId: null, fleetName: null, action: 'ssh.set' }));
    expect(store.auditFilterValues()).toEqual({
      users: [
        { id: 1, username: 'new' },
        { id: 2, username: '' },
      ],
      fleets: [{ id: 100, name: 'F-new' }],
      actions: ['device.reboot', 'ssh.set'],
    });
  });
  it('keeps the log through pruneUsers and reopening the schema', () => {
    store.recordAudit(entry({ userId: 7 }));
    store.pruneUsers([8]);
    expect(store.listAudit({ page: 1, perPage: 10 }).total).toBe(1);
  });
  it('creates the schema idempotently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-'));
    try {
      const path = join(dir, 'a.db');
      openStore(path).recordAudit(entry());
      expect(openStore(path).listAudit({ page: 1, perPage: 10 }).total).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
