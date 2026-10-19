import * as React from 'react';
import { Resource } from 'react-admin';
import { CustomerDeviceList } from './CustomerDeviceList';
import { CustomerDeviceShow } from './CustomerDeviceShow';
import { CustomerFleetList } from './CustomerFleetList';

// Registered under the admin resource names so references and routes behave as in admin.
export const customerResources = (
  <>
    <Resource name='device' options={{ label: 'Devices' }} list={CustomerDeviceList} show={CustomerDeviceShow} />
    <Resource name='application' options={{ label: 'Fleets' }} list={CustomerFleetList} />
  </>
);
