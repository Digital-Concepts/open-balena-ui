import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import FeedIcon from '@mui/icons-material/Feed';
import FeedOutlinedIcon from '@mui/icons-material/FeedOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SpeakerNotesIcon from '@mui/icons-material/SpeakerNotes';
import SpeakerNotesOffIcon from '@mui/icons-material/SpeakerNotesOff';
import { Box, Button, Card, CardActions, CardContent, Grid, Typography } from '@mui/material';
import * as React from 'react';
import { ReferenceField, TextField, useNotify, usePermissions, useRecordContext } from 'react-admin';
import { OnlineField } from '../../components/device';
import { can, Permissions } from '../../lib/me';
import { ConfirmationDialog, type ConfirmationDialogProps } from '../../ui/ConfirmationDialog';
import { customerApi } from '../api';

type DeviceRecord = { id: number | string; uuid: string; 'device name': string; 'api heartbeat state'?: string };

const ACTION_BTN_SX = {
  flexDirection: 'column',
  gap: 0.25,
  py: 0.5,
  minHeight: 48,
  height: '100%',
  textAlign: 'center',
  lineHeight: 1.1,
  fontSize: '0.72rem',
  '& .MuiButton-startIcon': { margin: 0 },
  '& .MuiSvgIcon-root': { fontSize: 18 },
} as const;

// Raw calls for multipart and binary responses; errors are {success:false,message} or {error}.
const rawCustomerFetch = (path: string, init: RequestInit) =>
  fetch(`/api/customer${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${localStorage.getItem('auth') ?? ''}`, ...(init.headers ?? {}) },
  });

const errorText = async (res: Response): Promise<string> => {
  const body = await res.json().catch(() => ({}));
  return body.message || body.error || res.statusText;
};

const saveBlob = async (res: Response, filename: string) => {
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 0);
};

// Same header and General card as the admin ControlsWidget, limited to what a customer may do.
const CustomerControlsWidget: React.FC = () => {
  const notify = useNotify();
  const record = useRecordContext<DeviceRecord>();
  const { permissions } = usePermissions<Permissions>();
  const [confirmationDialog, setConfirmationDialog] = React.useState<ConfirmationDialogProps | null>(null);

  if (!record) return null;

  const isOffline = record['api heartbeat state'] !== 'online';

  const reboot = async () => {
    try {
      await customerApi(`/devices/${record.uuid}/reboot`, { method: 'POST' });
      notify(`Successfully executed command reboot on device ${record['device name']}`, { type: 'success' });
    } catch (e) {
      notify((e as Error).message, { type: 'error' });
    }
  };

  const shortName = record['device name']?.split('-')[0] || record.uuid.slice(0, 8);
  const post = (suffix: string, body: unknown) =>
    rawCustomerFetch(`/devices/${record.uuid}${suffix}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });

  const controlLogLevel = async (logLevel: 'info' | 'debug') => {
    try {
      const res = await post('/log-level', { logLevels: logLevel });
      if (res.ok) notify(`Log level changed to ${logLevel} successfully`, { type: 'success' });
      else notify(`Failed to change log level: ${await errorText(res)}`, { type: 'error' });
    } catch (error) {
      console.error('Error while changing log level:', error);
      notify('An error occurred while changing log level', { type: 'error' });
    }
  };

  const controlSSH = async (status: 'on' | 'off') => {
    try {
      const res = await post('/ssh', { state: status });
      if (res.ok) notify(`SSH ${status === 'on' ? 'enabled' : 'disabled'} successfully`, { type: 'success' });
      else
        notify(`Failed to ${status === 'on' ? 'enable' : 'disable'} SSH: ${await errorText(res)}`, { type: 'error' });
    } catch (error) {
      console.error('Error while changing SSH status:', error);
      notify('An error occurred while changing SSH status', { type: 'error' });
    }
  };

  const download = async (suffix: string, filename: string, what: string) => {
    try {
      const res = await post(suffix, {});
      if (res.ok) await saveBlob(res, filename);
      else notify(`Failed to download ${what}: ${await errorText(res)}`, { type: 'error' });
    } catch (error) {
      console.error(`Error while downloading ${what}`, error);
      notify(`An error occurred while downloading ${what}`, { type: 'error' });
    }
  };

  const uploadFiles = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e: Event) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;
      const formData = new FormData();
      for (const file of Array.from(files)) formData.append('files', file);
      try {
        const res = await rawCustomerFetch(`/devices/${record.uuid}/files`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await errorText(res));
        notify('Files uploaded successfully', { type: 'success' });
      } catch (error) {
        console.error('Upload error:', error);
        notify(`Failed to upload files: ${(error as Error).message}`, { type: 'error' });
      }
    };
    input.click();
  };

  const showGeneral = can(permissions, 'device.actions');
  const showLogs = can(permissions, 'device.loglevel') || can(permissions, 'device.logs.download');
  const showFiles = can(permissions, 'device.files');
  const showSsh = can(permissions, 'device.ssh');

  const actionButton = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <Grid item xs={6}>
      <Button fullWidth sx={ACTION_BTN_SX} variant='outlined' size='small' onClick={onClick} startIcon={icon} disabled={isOffline}>
        {label}
      </Button>
    </Grid>
  );

  const card = (title: string, children: React.ReactNode) => (
    <Grid item xs={12} md={6}>
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant='body1' fontWeight='bold'>
            {title}
          </Typography>
        </CardContent>
        <CardActions>
          <Grid container spacing={1}>
            {children}
          </Grid>
        </CardActions>
      </Card>
    </Grid>
  );

  return (
    <>
      <Typography variant='h5' component='h2' gutterBottom>
        {record['device name']}
      </Typography>
      <Box maxWidth='40em'>
        <p style={{ marginBottom: '5px' }}>
          <b>Fleet: </b>
          <ReferenceField source='belongs to-application' reference='application' target='id' link={false}>
            <TextField source='app name' style={{ fontSize: '12pt' }} />
          </ReferenceField>
        </p>
        <p style={{ margin: 0 }}>
          <b>Status: </b>
          <OnlineField source='api heartbeat state' />
        </p>
      </Box>
      {(showGeneral || showLogs || showFiles || showSsh) && (
        <Box sx={{ width: '100%' }}>
          <Grid container spacing={2}>
            {showGeneral &&
              card(
                'General',
                <Grid item xs={6}>
                  <Button
                    fullWidth
                    sx={ACTION_BTN_SX}
                    variant='outlined'
                    size='small'
                    onClick={() =>
                      setConfirmationDialog({
                        title: 'Reboot Device',
                        content: 'Are you sure you want to reboot this device?',
                        onConfirm: reboot,
                      })
                    }
                    startIcon={<RestartAltIcon />}
                    disabled={isOffline}
                  >
                    Reboot
                  </Button>
                </Grid>,
              )}
            {showLogs &&
              card(
                'Logs',
                <>
                  {can(permissions, 'device.loglevel') &&
                    actionButton('Set to info', <FeedIcon />, () => controlLogLevel('info'))}
                  {can(permissions, 'device.loglevel') &&
                    actionButton('Set to debug', <FeedOutlinedIcon />, () => controlLogLevel('debug'))}
                  {can(permissions, 'device.logs.download') &&
                    actionButton('Download', <DownloadIcon />, () =>
                      download('/logs/download', `logs_${shortName}.tar.gz`, 'logs'),
                    )}
                </>,
              )}
            {showFiles &&
              card(
                'Files',
                <>
                  {actionButton('Upload Files', <CloudUploadIcon />, uploadFiles)}
                  {actionButton('Download Files', <CloudDownloadIcon />, () =>
                    download('/files/download', `outbound_${shortName}.zip`, 'Files'),
                  )}
                </>,
              )}
            {showSsh &&
              card(
                'SSH',
                <>
                  {actionButton('Enable SSH', <SpeakerNotesIcon />, () => controlSSH('on'))}
                  {actionButton('Disable SSH', <SpeakerNotesOffIcon />, () => controlSSH('off'))}
                </>,
              )}
          </Grid>
        </Box>
      )}
      {!!confirmationDialog && <ConfirmationDialog {...confirmationDialog} onClose={() => setConfirmationDialog(null)} />}
    </>
  );
};

export default CustomerControlsWidget;
