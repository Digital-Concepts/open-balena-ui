import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

vi.mock('react-admin', () => ({
  usePermissions: () => ({
    permissions: { status: 'ok', me: { userId: 5, permissionSet: { id: 2, name: 'C' }, capabilities: ['device.read', 'device.logs'] } },
  }),
}));

import Can from '../Can';

describe('Can', () => {
  it('renders children only with the capability', () => {
    render(
      <>
        <Can cap='device.logs'>logs</Can>
        <Can cap='device.actions'>reboot</Can>
      </>,
    );
    expect(screen.queryByText('logs')).not.toBeNull();
    expect(screen.queryByText('reboot')).toBeNull();
  });
});
