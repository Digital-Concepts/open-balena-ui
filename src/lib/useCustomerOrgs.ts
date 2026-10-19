import * as React from 'react';
import { useGetList } from 'react-admin';
import { adminFetch, OrgSettings } from './adminApi';

export type CustomerOrgs = { status: 'loading' | 'error' | 'ready'; orgs: { id: number; name: string }[] };

// Customer orgs (orgs with a permission set): one settings request plus the org names list.
export function useCustomerOrgs(): CustomerOrgs {
  const list = useGetList('organization', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'name', order: 'ASC' },
  });
  const [settings, setSettings] = React.useState<OrgSettings[] | null | 'error'>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await adminFetch('/api/admin/org-settings');
      if (cancelled) return;
      setSettings(r.ok && Array.isArray(r.body?.data) ? r.body.data : 'error');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return React.useMemo(() => {
    if (list.error || settings === 'error') return { status: 'error', orgs: [] };
    if (!list.data || !settings) return { status: 'loading', orgs: [] };
    const customer = new Set(settings.filter((s) => s.permissionSetId !== null).map((s) => String(s.orgId)));
    return {
      status: 'ready',
      orgs: list.data.filter((o) => customer.has(String(o.id))).map((o) => ({ id: Number(o.id), name: o.name })),
    };
  }, [list.data, list.error, settings]);
}
