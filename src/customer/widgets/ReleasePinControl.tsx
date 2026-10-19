import { Box, Button, MenuItem, Stack, TextField } from '@mui/material';
import { styled } from '@mui/material/styles';
import * as React from 'react';
import { useNotify, useRecordContext, useRefresh } from 'react-admin';
import { customerApi } from '../api';

type Release = { id: number; label: string; commit: string; createdAt: string };
type Device = { uuid: string; 'is pinned on-release': number | null };

const Label = styled('span')(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontSize: '11px',
  display: 'block',
  textTransform: 'uppercase',
  marginBottom: '6px',
}));

// Pins the device to a release of its fleet, or follows the fleet again.
const ReleasePinControl: React.FC = () => {
  const device = useRecordContext<Device>();
  const notify = useNotify();
  const refresh = useRefresh();
  const [releases, setReleases] = React.useState<Release[]>([]);
  const [loadError, setLoadError] = React.useState('');
  const [value, setValue] = React.useState<string>('');
  const pinnedId = device?.['is pinned on-release'] ?? null;

  React.useEffect(() => {
    if (!device) return;
    setValue(pinnedId ? String(pinnedId) : '');
    setLoadError('');
    customerApi<Release[]>(`/devices/${device.uuid}/releases`)
      .then(setReleases)
      .catch((e) => {
        setReleases([]);
        setLoadError((e as Error).message);
        notify((e as Error).message, { type: 'error' });
      });
  }, [device?.uuid, pinnedId]);

  const save = async () => {
    try {
      await customerApi(`/devices/${device!.uuid}/pinned-release`, {
        method: 'PATCH',
        body: JSON.stringify({ releaseId: value === '' ? null : Number(value) }),
      });
      notify('Release updated', { type: 'success' });
      refresh();
    } catch (e) {
      notify((e as Error).message, { type: 'error' });
    }
  };

  if (!device) return null;
  return (
    <Box sx={{ px: '15px', mt: '30px' }}>
      <Label>Pin Target Release</Label>
      {loadError && <Box sx={{ color: 'error.main', mb: 1 }}>Could not load releases: {loadError}</Box>}
      <Stack direction='row' spacing={2} alignItems='center'>
        <TextField select size='small' label='Pinned release' value={value} onChange={(e) => setValue(e.target.value)} sx={{ minWidth: 320 }}>
          <MenuItem value=''>Follow fleet (not pinned)</MenuItem>
          {value !== '' && !releases.some((r) => String(r.id) === value) && (
            <MenuItem value={value} disabled>
              Release {value} (current)
            </MenuItem>
          )}
          {releases.map((r) => (
            <MenuItem key={r.id} value={String(r.id)}>
              {r.label} — {new Date(r.createdAt).toLocaleDateString()}
            </MenuItem>
          ))}
        </TextField>
        <Button variant='contained' disabled={!!loadError} onClick={() => void save()}>
          Save
        </Button>
      </Stack>
    </Box>
  );
};

export default ReleasePinControl;
