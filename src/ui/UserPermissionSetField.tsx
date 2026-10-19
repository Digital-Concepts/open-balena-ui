import { Chip } from '@mui/material';
import * as React from 'react';
import { useGetList, useNotify } from 'react-admin';
import { authHeaders } from '../lib/adminApi';

export type LookupEntry = { setName: string | null; customerOrg: string | null };
export type PermissionSetLookup = { status: 'loading' | 'error' | 'ready'; byUser: Map<string, LookupEntry> };

// Pure mapping: the effective permission set label for one user.
export function permissionSetLabel(lookup: PermissionSetLookup, userId: number | string) {
  if (lookup.status === 'error') return { kind: 'error' as const, text: '?' };
  if (lookup.status === 'loading') return { kind: 'loading' as const, text: '…' };
  const entry = lookup.byUser.get(String(userId));
  const name = entry?.setName;
  if (!name && entry?.customerOrg) return { kind: 'none' as const, text: 'none (org has no customer permission set)' };
  return name ? { kind: 'set' as const, text: name } : { kind: 'none' as const, text: '— none —' };
}

// Pure mapping: org name for customers, "Internal" otherwise.
export function customerLabel(lookup: PermissionSetLookup, userId: number | string) {
  if (lookup.status === 'error') return { kind: 'error' as const, text: '?' };
  if (lookup.status === 'loading') return { kind: 'loading' as const, text: '…' };
  const org = lookup.byUser.get(String(userId))?.customerOrg;
  return org ? { kind: 'customer' as const, text: org } : { kind: 'internal' as const, text: 'Internal' };
}

export type Assignment = {
  userId: number | string;
  type?: string;
  permissionSetId: number | string | null;
  orgId?: number | string | null;
};

export function buildLookup(
  assignments: Assignment[],
  sets: { id: number | string; name: string }[],
  orgs: { id: number | string; name: string }[] = [],
): Map<string, LookupEntry> {
  const names = new Map(sets.map((s) => [String(s.id), s.name]));
  const orgNames = new Map(orgs.map((o) => [String(o.id), o.name]));
  const byUser = new Map<string, LookupEntry>();
  for (const a of assignments) {
    const customer = a.type === 'customer';
    byUser.set(String(a.userId), {
      setName: a.permissionSetId == null ? null : (names.get(String(a.permissionSetId)) ?? null),
      customerOrg: customer ? (orgNames.get(String(a.orgId)) ?? `org ${a.orgId}`) : null,
    });
  }
  return byUser;
}

// Loads assignments and sets once; one error notification on failure.
export function usePermissionSetLookup(): PermissionSetLookup {
  const notify = useNotify();
  const sets = useGetList('permission-sets', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });
  const orgs = useGetList('organization', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'name', order: 'ASC' },
  });
  const [assignments, setAssignments] = React.useState<Assignment[] | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/admin/permission-assignments', { headers: authHeaders() });
        const b = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || !b || !Array.isArray(b.data)) {
          setFailed(true);
          return;
        }
        setAssignments(b.data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const error = failed || !!sets.error || !!orgs.error;
  const notified = React.useRef(false);
  React.useEffect(() => {
    if (error && !notified.current) {
      notified.current = true;
      notify('Could not load permission sets', { type: 'error' });
    }
  }, [error, notify]);

  return React.useMemo(() => {
    if (error) return { status: 'error', byUser: new Map() };
    if (!assignments || !sets.data || !orgs.data) return { status: 'loading', byUser: new Map() };
    return { status: 'ready', byUser: buildLookup(assignments, sets.data, orgs.data) };
  }, [error, assignments, sets.data, orgs.data]);
}

export const PermissionSetLookupContext = React.createContext<PermissionSetLookup>({
  status: 'loading',
  byUser: new Map(),
});

export const UserPermissionSetField: React.FC<{ userId: number | string }> = ({ userId }) => {
  const label = permissionSetLabel(React.useContext(PermissionSetLookupContext), userId);
  if (label.kind === 'set') return <Chip size='small' label={label.text} />;
  return <span style={{ color: 'grey' }}>{label.text}</span>;
};

export const UserCustomerField: React.FC<{ userId: number | string }> = ({ userId }) => {
  const label = customerLabel(React.useContext(PermissionSetLookupContext), userId);
  if (label.kind === 'customer') return <Chip size='small' color='primary' label={label.text} />;
  return <span style={{ color: 'grey' }}>{label.text}</span>;
};
