export const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('auth') ?? ''}`,
});

export type ApiResult = { ok: boolean; body: any };

// Fetch against the admin API; network and JSON failures never throw.
export async function adminFetch(path: string, init?: RequestInit): Promise<ApiResult> {
  try {
    const r = await fetch(path, { ...init, headers: authHeaders() });
    const body = await r.json().catch(() => null);
    return { ok: r.ok, body };
  } catch {
    return { ok: false, body: null };
  }
}

export const apiMessage = (body: any, fallback: string): string => body?.message ?? body?.error ?? fallback;

export type OrgSettings = { orgId: number; isCustomer: boolean; permissionSetId: number | null; userCount: number };

export const isOrgSettings = (b: any): b is OrgSettings =>
  !!b && typeof b === 'object' && typeof b.isCustomer === 'boolean' && 'permissionSetId' in b;

export type Account =
  | { type: 'internal'; permissionSetId: number | null }
  | { type: 'customer'; orgId: number; effectivePermissionSetId: number | null };

export const isAccount = (b: any): b is Account =>
  !!b && typeof b === 'object' && (b.type === 'internal' || b.type === 'customer');

export type AccountChoice = { type: 'internal' | 'customer'; orgId: string; permissionSetId: string };

export const choiceBody = (c: AccountChoice) =>
  c.type === 'customer'
    ? { type: 'customer', orgId: Number(c.orgId) }
    : { type: 'internal', permissionSetId: c.permissionSetId === '' ? null : Number(c.permissionSetId) };

export const putAccount = (userId: number | string, c: AccountChoice) =>
  adminFetch(`/api/admin/users/${userId}/account`, { method: 'PUT', body: JSON.stringify(choiceBody(c)) });

export const toChoice = (a: Account): AccountChoice =>
  a.type === 'customer'
    ? { type: 'customer', orgId: String(a.orgId), permissionSetId: '' }
    : { type: 'internal', orgId: '', permissionSetId: a.permissionSetId == null ? '' : String(a.permissionSetId) };

// True when the chosen account differs from the loaded one (only the fields of the chosen type count).
export const choiceChanged = (loaded: Account, c: AccountChoice): boolean => {
  const base = toChoice(loaded);
  return (
    base.type !== c.type ||
    (c.type === 'customer' ? base.orgId !== c.orgId : base.permissionSetId !== c.permissionSetId)
  );
};

export type OrgSettingsChoice = { permissionSetId: string };

export const toSettingsChoice = (s: Pick<OrgSettings, 'permissionSetId'>): OrgSettingsChoice => ({
  permissionSetId: s.permissionSetId == null ? '' : String(s.permissionSetId),
});

export const settingsChanged = (loaded: OrgSettings, c: OrgSettingsChoice): boolean => {
  const base = toSettingsChoice(loaded);
  return base.permissionSetId !== c.permissionSetId;
};

export const putOrgSettings = (orgId: number | string, c: OrgSettingsChoice) =>
  adminFetch(`/api/admin/orgs/${orgId}/settings`, {
    method: 'PUT',
    body: JSON.stringify({
      permissionSetId: c.permissionSetId === '' ? null : Number(c.permissionSetId),
    }),
  });
