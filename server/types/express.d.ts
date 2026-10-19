import type { Capability } from '../permissions/capabilities';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number };
      capabilities?: Capability[];
      permissionSet?: { id: number; name: string };
      /** Device loaded in scope by the route; audited() records only when set. */
      auditDevice?: { uuid: string; name: string | null; fleetId: number | null };
      /** Allowlisted details for the audit entry. */
      auditDetails?: Record<string, unknown>;
    }
  }
}

export {};
