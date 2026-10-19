import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

let capabilities: string[] = [];
vi.mock('react-admin', () => {
  const Tab = ({ label, children }: any) => (
    <section data-testid='tab' aria-label={label}>
      {children}
    </section>
  );
  const TabbedShowLayout: any = ({ children }: any) => <div>{children}</div>;
  TabbedShowLayout.Tab = Tab;
  return {
    TabbedShowLayout,
    Title: () => null,
    useRecordContext: () => ({ id: 1, uuid: 'abc', 'device name': 'gw-1' }),
    usePermissions: () => ({ permissions: { status: 'ok', me: { userId: 1, permissionSet: { id: 1, name: 'c' }, capabilities } } }),
  };
});
vi.mock('../../dashboards/device/summaryWidget', () => ({ default: () => <div>summary-widget</div> }));
vi.mock('../../dashboards/device/usageWidget', () => ({ default: () => <div>usage-widget</div> }));
vi.mock('../../ui/DeviceConnectButton', () => ({ default: () => <button>fullscreen</button> }));
vi.mock('../widgets/CustomerControlsWidget', () => ({ default: () => <div>controls</div> }));
vi.mock('../widgets/CustomerDeviceServices', () => ({ default: () => <div>services</div> }));
vi.mock('../widgets/CustomerTagsWidget', () => ({ default: () => <div>tags-widget</div> }));
vi.mock('../widgets/CustomerDeviceLogs', () => ({ default: () => <div>logs-card</div> }));
vi.mock('../widgets/CustomerDeviceConnect', () => ({ default: () => <div>connect-card</div> }));
vi.mock('../widgets/ReleasePinControl', () => ({ default: () => <div>pin-control</div> }));

import CustomerDashboardLayout from '../CustomerDashboardLayout';

describe('CustomerDashboardLayout', () => {
  it('has only the Summary and Tags tabs, and no logs, connect or pin without capabilities', () => {
    capabilities = ['device.read'];
    render(<CustomerDashboardLayout />);
    expect(screen.getAllByTestId('tab').map((t) => t.getAttribute('aria-label'))).toEqual(['Summary', 'Tags']);
    for (const text of ['controls', 'summary-widget', 'tags-widget', 'usage-widget', 'services']) {
      expect(screen.queryByText(text)).not.toBeNull();
    }
    for (const text of ['logs-card', 'connect-card', 'pin-control']) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });

  it('shows logs, connect and the release pin with their capabilities', () => {
    capabilities = ['device.read', 'device.logs', 'device.terminal', 'device.release.pin'];
    render(<CustomerDashboardLayout />);
    for (const text of ['logs-card', 'connect-card', 'pin-control']) {
      expect(screen.queryByText(text)).not.toBeNull();
    }
  });
});
