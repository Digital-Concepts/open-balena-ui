import * as React from 'react';
import { usePermissions } from 'react-admin';
import { can, Permissions } from '../lib/me';

// Cosmetic only: the server enforces every capability again.
const Can: React.FC<{ cap: string; children: React.ReactNode }> = ({ cap, children }) => {
  const { permissions } = usePermissions<Permissions>();
  return can(permissions, cap) ? <>{children}</> : null;
};

export default Can;
