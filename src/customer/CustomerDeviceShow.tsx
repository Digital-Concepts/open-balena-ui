import * as React from 'react';
import { Show } from 'react-admin';
import CustomerDashboardLayout from './CustomerDashboardLayout';

export const CustomerDeviceShow: React.FC = () => (
  <Show component='div' title='Device Dashboard' actions={false}>
    <CustomerDashboardLayout />
  </Show>
);
