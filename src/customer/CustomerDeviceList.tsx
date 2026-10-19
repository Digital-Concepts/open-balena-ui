import { Box, Button, FormControl, MenuItem, Select, Tooltip } from '@mui/material';
import dateFormat from 'dateformat';
import * as React from 'react';
import {
  Datagrid,
  FunctionField,
  List,
  Pagination,
  ReferenceField,
  SearchInput,
  ShowButton,
  TextField,
  Toolbar,
  WithRecord,
  useGetList,
  useListContext,
} from 'react-admin';
import { OnlineField, ReleaseField } from '../components/device';
import { DEVICE_SEARCH_KEY } from '../lib/deviceFilters';
import DeviceConnectButton from '../ui/DeviceConnectButton';
import DeviceServicesButton from '../ui/DeviceServicesButton';
import { renderIpAddressLink } from '../ui/ipAddressLink';
import Can from './Can';
import CustomerDeviceConnect from './widgets/CustomerDeviceConnect';
import CustomerDeviceServices from './widgets/CustomerDeviceServices';

const FLEET_FILTER = 'belongs to-application';

const deviceFilters = [<SearchInput key='search' source={DEVICE_SEARCH_KEY} alwaysOn />];

const selectSx = (theme: any) => ({
  backgroundColor: theme.palette.primary.main,
  color: theme.palette.primary.contrastText,
  '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.primary.main },
  '& .MuiSelect-icon': { color: theme.palette.primary.contrastText },
});

const menuPaperSx = (theme: any) => ({
  backgroundColor: theme.palette.primary.main,
  '& .MuiMenuItem-root': {
    color: theme.palette.primary.contrastText,
    '&:hover': { backgroundColor: theme.palette.primary.light },
    '&.Mui-selected': {
      backgroundColor: theme.palette.primary.light,
      '&:hover': { backgroundColor: theme.palette.primary.light },
    },
  },
});

// Fleet filter styled like the admin device list's fleet select, bound to the list filter.
const FleetFilter: React.FC = () => {
  const { filterValues, setFilters } = useListContext();
  const { data: fleets } = useGetList('application', {
    sort: { field: 'app name', order: 'ASC' },
    pagination: { page: 1, perPage: 1000 },
  });
  const selected = filterValues[FLEET_FILTER] ?? '';
  const change = (fleetId: string | number) => {
    const { [FLEET_FILTER]: _drop, ...rest } = filterValues;
    setFilters(fleetId === '' ? rest : { ...rest, [FLEET_FILTER]: fleetId }, undefined);
  };

  return (
    <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
      <FormControl size='small' sx={{ minWidth: 200 }}>
        <Select
          value={fleets?.some((f: any) => String(f.id) === String(selected)) ? selected : ''}
          onChange={(e) => change(e.target.value as string | number)}
          displayEmpty
          sx={selectSx}
          MenuProps={{ PaperProps: { sx: menuPaperSx } }}
        >
          <MenuItem value=''>
            <b>All Fleets</b>
          </MenuItem>
          {fleets?.map((fleet: any) => (
            <MenuItem key={fleet.id} value={fleet.id}>
              {fleet['app name']}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {selected !== '' && (
        <Button variant='outlined' size='small' onClick={() => change('')} sx={{ height: 'fit-content' }}>
          Clear Filter
        </Button>
      )}
    </Box>
  );
};

const CustomerPagination: React.FC = () => <Pagination rowsPerPageOptions={[25, 50, 100]} />;

// Same columns and styling as the admin device list, without client, edit, delete and bulk actions.
export const CustomerDeviceList: React.FC = () => (
  <List title='Devices' filters={deviceFilters} pagination={<CustomerPagination />} exporter={false}>
    <FleetFilter />
    <Datagrid rowClick={false} bulkActionButtons={false} size='medium'>
      <ReferenceField label='Name' source='id' reference='device' target='id' link='show' sortBy='device name'>
        <TextField source='device name' />
      </ReferenceField>

      <OnlineField label='Status' source='api heartbeat state' />

      <FunctionField
        label='VPN Status'
        render={(record) => (
          <Tooltip placement='top' arrow={true} title={'Since ' + dateFormat(new Date(record['last vpn event']))}>
            <span>{record['is connected to vpn'] ? 'Connected' : 'Disconnected'}</span>
          </Tooltip>
        )}
      />

      <FunctionField label='IP Address' render={renderIpAddressLink} />

      <ReleaseField label='Current Release' source='is running-release' />

      <FunctionField
        label='Notes'
        render={(record) => (
          <Box sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={record.note || ''}>
            {record.note || ''}
          </Box>
        )}
      />

      <ReferenceField label='Fleet' source='belongs to-application' reference='application' target='id'>
        <TextField source='app name' />
      </ReferenceField>

      <Toolbar sx={{ background: 'none', padding: '0' }}>
        <ShowButton variant='outlined' label='' size='small' />
        <WithRecord
          render={(device) => (
            <>
              <DeviceServicesButton variant='outlined' size='small' device={device} ServicesComponent={CustomerDeviceServices} />
              <Can cap='device.terminal'>
                <DeviceConnectButton variant='outlined' size='small' record={device} ConnectComponent={CustomerDeviceConnect} />
              </Can>
            </>
          )}
        />
      </Toolbar>
    </Datagrid>
  </List>
);
