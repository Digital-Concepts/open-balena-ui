import { describe, it, expect } from 'vitest';
import { buildLookup, customerLabel, permissionSetLabel } from '../UserPermissionSetField';

const sets = [{ id: 1, name: 'Admin' }, { id: 2, name: 'Customer' }];
const orgs = [{ id: 7, name: 'Acme' }];

describe('lookup labels', () => {
  const byUser = buildLookup(
    [
      { userId: 5, type: 'internal', permissionSetId: 1, orgId: null },
      { userId: 6, type: 'customer', permissionSetId: 2, orgId: 7 },
      { userId: 8, type: 'customer', permissionSetId: null, orgId: 7 },
      { userId: 9, type: 'internal', permissionSetId: 99, orgId: null },
    ],
    sets,
    orgs,
  );
  const ready = { status: 'ready' as const, byUser };

  it('shows the effective set name', () => {
    expect(permissionSetLabel(ready, 5)).toEqual({ kind: 'set', text: 'Admin' });
    expect(permissionSetLabel(ready, 6)).toEqual({ kind: 'set', text: 'Customer' });
  });
  it('shows none when unassigned, unknown set or unknown user', () => {
    expect(permissionSetLabel(ready, 8).text).toBe('none (org has no customer permission set)');
    expect(permissionSetLabel(ready, 9).text).toBe('— none —');
    expect(permissionSetLabel(ready, 1).text).toBe('— none —');
  });
  it('customer column: org name or Internal', () => {
    expect(customerLabel(ready, 6)).toEqual({ kind: 'customer', text: 'Acme' });
    expect(customerLabel(ready, 5)).toEqual({ kind: 'internal', text: 'Internal' });
    expect(customerLabel(ready, 1).text).toBe('Internal');
  });
  it('shows ? on error', () => {
    expect(permissionSetLabel({ status: 'error', byUser: new Map() }, 5)).toEqual({ kind: 'error', text: '?' });
    expect(customerLabel({ status: 'error', byUser: new Map() }, 5).text).toBe('?');
  });
});
