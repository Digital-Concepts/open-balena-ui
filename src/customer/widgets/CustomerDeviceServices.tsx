import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import StopIcon from '@mui/icons-material/Stop';
import TripOriginIcon from '@mui/icons-material/TripOrigin';
import { Box, Button, useTheme } from '@mui/material';
import * as React from 'react';
import {
  Datagrid,
  FunctionField,
  ListContextProvider,
  ReferenceField,
  Toolbar,
  WithRecord,
  useList,
  useNotify,
  usePermissions,
  useRecordContext,
} from 'react-admin';
import { can, Permissions } from '../../lib/me';
import SemVerChip from '../../ui/SemVerChip';
import { customerApi } from '../api';

type Service = { imageId: number; serviceId: number; serviceName: string; releaseId: number | null; status: string };
type ServiceRow = Service & { id: number; 'is provided by-release': number | null };
type Command = 'start' | 'stop' | 'restart';

// Same service table as the admin DeviceServices, fed from the customer API.
const CustomerDeviceServices: React.FC<{ device?: { uuid: string; 'device name'?: string; 'is running-release'?: number | string | null } }> = ({ device: deviceProp }) => {
  const contextRecord = useRecordContext<{ uuid: string; 'device name'?: string; 'is running-release'?: number | string | null }>();
  const device = deviceProp ?? contextRecord;
  const notify = useNotify();
  const theme = useTheme();
  const { permissions } = usePermissions<Permissions>();
  const canAct = can(permissions, 'device.actions');
  const [rows, setRows] = React.useState<ServiceRow[]>([]);
  const [loadError, setLoadError] = React.useState('');
  const [isExecutingCommand, setIsExecutingCommand] = React.useState(false);

  const load = React.useCallback(() => {
    if (!device?.uuid) return;
    customerApi<Service[]>(`/devices/${device.uuid}/services`)
      .then((s) => {
        setLoadError('');
        // Like admin: only the installs of the release the device is running.
        const running = device['is running-release'];
        setRows(
          s
            .filter((r) => !running || String(r.releaseId) === String(running))
            .map((r) => ({ ...r, id: r.imageId, 'is provided by-release': r.releaseId })),
        );
      })
      .catch((e) => {
        setRows([]);
        setLoadError((e as Error).message);
      });
  }, [device?.uuid, device?.['is running-release']]);
  React.useEffect(load, [load]);

  const listContext = useList<ServiceRow>({ data: rows, perPage: 1000, isPending: false });

  const invoke = async (service: ServiceRow, command: Command) => {
    if (!device) return;
    setIsExecutingCommand(true);
    try {
      await customerApi(`/devices/${device.uuid}/services/${service.imageId}/${command}`, { method: 'POST' });
      notify(`Successfully executed command ${command} on device ${device['device name'] ?? 'device'}`, { type: 'success' });
      load();
    } catch {
      notify(`Error: Could not execute command ${command} on device ${device['device name'] ?? 'device'}`, { type: 'error' });
    } finally {
      setIsExecutingCommand(false);
    }
  };

  if (!device) return null;
  if (loadError) return <Box sx={{ color: 'error.main' }}>Could not load services: {loadError}</Box>;

  return (
    <ListContextProvider value={listContext}>
      <Datagrid bulkActionButtons={false} rowClick={false}>
        <WithRecord
          render={(service: ServiceRow) => {
            const color =
              service.status === 'Running'
                ? theme.palette.success.light
                : service.status === 'Error'
                  ? theme.palette.error.light
                  : theme.palette.warning.light;
            return <TripOriginIcon sx={{ color }} />;
          }}
        />

        <FunctionField label='Image' sortable={false} render={(s: ServiceRow) => s.serviceName} />

        <FunctionField label='Status' sortable={false} render={(s: ServiceRow) => s.status} />

        <ReferenceField label='Release' source='is provided by-release' reference='release' target='id' sortable={false}>
          <SemVerChip />
        </ReferenceField>

        {canAct && (
          <FunctionField
            sortable={false}
            render={(s: ServiceRow) => {
              const isRunning = s.status?.toLowerCase() === 'running';
              return (
                <Toolbar style={{ minHeight: 0, minWidth: 0, padding: 0, margin: 0, background: 0, textAlign: 'center' }}>
                  <Button
                    aria-label={`start ${s.serviceName}`}
                    onClick={() => void invoke(s, 'start')}
                    disabled={isRunning || isExecutingCommand}
                    variant='text'
                    sx={{ p: '4px', m: '4px', minWidth: 0 }}
                  >
                    <PlayArrowIcon />
                  </Button>
                  <Button
                    aria-label={`stop ${s.serviceName}`}
                    onClick={() => void invoke(s, 'stop')}
                    disabled={!isRunning || isExecutingCommand}
                    variant='text'
                    sx={{ p: '4px', m: '4px', minWidth: 0 }}
                  >
                    <StopIcon />
                  </Button>
                  <Button
                    aria-label={`restart ${s.serviceName}`}
                    onClick={() => void invoke(s, 'restart')}
                    disabled={isExecutingCommand}
                    variant='text'
                    sx={{ p: '4px', m: '4px', minWidth: 0 }}
                  >
                    <RestartAltIcon />
                  </Button>
                </Toolbar>
              );
            }}
          />
        )}
      </Datagrid>
    </ListContextProvider>
  );
};

export default CustomerDeviceServices;
