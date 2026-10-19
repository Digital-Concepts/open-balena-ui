import type { Capability } from '../permissions/capabilities';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number };
      capabilities?: Capability[];
      permissionSet?: { id: number; name: string };
    }
  }
}

export {};
