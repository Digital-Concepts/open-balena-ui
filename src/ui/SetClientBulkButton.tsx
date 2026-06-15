import * as React from 'react';
import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import { useListContext, useNotify, useRefresh } from 'react-admin';
import { useDistinctClientValues, useUpsertDeviceClient } from '../lib/deviceClient';

const SetClientBulkButton: React.FC = () => {
  const { selectedIds = [], onUnselectItems } = useListContext();
  const { values: knownClients } = useDistinctClientValues();
  const upsertClient = useUpsertDeviceClient();
  const notify = useNotify();
  const refresh = useRefresh();

  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setValue('');
  };

  const apply = async (clientValue: string) => {
    setBusy(true);
    let success = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await upsertClient(id, clientValue);
        success += 1;
      } catch (err) {
        console.error('Bulk client upsert failed for device', id, err);
        failed += 1;
      }
    }
    setBusy(false);
    setOpen(false);
    setValue('');

    const action = clientValue.trim() === '' ? 'cleared' : `set to "${clientValue.trim()}"`;
    if (failed === 0) {
      notify(`Client ${action} on ${success} device${success === 1 ? '' : 's'}`, { type: 'success' });
    } else {
      notify(`Client ${action} on ${success}, failed on ${failed}`, { type: 'warning' });
    }

    onUnselectItems?.();
    refresh();
  };

  return (
    <>
      <Button size='small' startIcon={<LocalOfferIcon />} onClick={() => setOpen(true)}>
        Set Client
      </Button>
      <Dialog open={open} onClose={close} fullWidth maxWidth='xs'>
        <DialogTitle>
          Set client on {selectedIds.length} device{selectedIds.length === 1 ? '' : 's'}
        </DialogTitle>
        <DialogContent>
          <Autocomplete
            freeSolo
            options={knownClients}
            value={value}
            onInputChange={(_e, next) => setValue(next ?? '')}
            disabled={busy}
            renderInput={(params) => (
              <TextField
                {...params}
                label='Client'
                placeholder='Type or pick a client…'
                size='small'
                autoFocus
                margin='dense'
              />
            )}
          />
        </DialogContent>
        <DialogActions className='custom' sx={{ justifyContent: 'space-between' }}>
          <Button onClick={() => apply('')} disabled={busy} color='error'>
            Clear client
          </Button>
          <span>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => apply(value)} disabled={busy || value.trim() === ''} variant='contained'>
              Apply
            </Button>
          </span>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SetClientBulkButton;
