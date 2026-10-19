import * as React from 'react';
import { Datagrid, List, TextField } from 'react-admin';

// Fleets of the customer organisations; a row opens the device list filtered by that fleet.
export const CustomerFleetList: React.FC = () => (
  <List title='Fleets' pagination={false} exporter={false} actions={false}>
    <Datagrid
      bulkActionButtons={false}
      size='medium'
      rowClick={(id) => `/device?filter=${encodeURIComponent(JSON.stringify({ 'belongs to-application': id }))}`}
    >
      <TextField label='Name' source='app name' sortable={false} />
    </Datagrid>
  </List>
);
