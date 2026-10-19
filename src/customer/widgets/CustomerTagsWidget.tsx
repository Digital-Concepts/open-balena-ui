import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField as MuiTextField } from '@mui/material';
import * as React from 'react';
import { Datagrid, FunctionField, ListContextProvider, Toolbar, WithRecord, useList, useNotify, useRecordContext } from 'react-admin';
import CopyChip from '../../ui/CopyChip';
import { customerApi } from '../api';
import Can from '../Can';

type Tag = { id: number; key: string; value: string };

// Same tags table as the admin tags widget; writes go through the customer API.
const CustomerTagsWidget: React.FC = () => {
  const device = useRecordContext<{ uuid: string }>();
  const notify = useNotify();
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [loadError, setLoadError] = React.useState('');
  const [dialog, setDialog] = React.useState<{ id: number | null; key: string; value: string } | null>(null);

  const load = React.useCallback(() => {
    if (!device?.uuid) return;
    customerApi<Tag[]>(`/devices/${device.uuid}/tags`)
      .then((t) => {
        setLoadError('');
        setTags(t);
      })
      .catch((e) => {
        setTags([]);
        setLoadError((e as Error).message);
      });
  }, [device?.uuid]);
  React.useEffect(load, [load]);

  const listContext = useList<Tag>({ data: tags, perPage: 1000, isPending: false });

  const call = async (path: string, init: RequestInit) => {
    try {
      await customerApi(path, init);
      load();
      return true;
    } catch (e) {
      notify((e as Error).message, { type: 'error' });
      return false;
    }
  };

  if (!device) return null;
  const base = `/devices/${device.uuid}/tags`;

  const save = async () => {
    if (!dialog) return;
    const ok = dialog.id === null
      ? await call(base, { method: 'POST', body: JSON.stringify({ key: dialog.key.trim(), value: dialog.value }) })
      : await call(`${base}/${dialog.id}`, { method: 'PATCH', body: JSON.stringify({ value: dialog.value }) });
    if (ok) setDialog(null);
  };

  return (
    <Box
      sx={{
        'px': '15px',
        '.RaList-noResults': { height: 'auto', paddingBottom: '30px' },
      }}
    >
      {loadError && <Box sx={{ color: 'error.main', mb: 1 }}>Could not load tags: {loadError}</Box>}
      <Can cap='device.tags.write'>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Button size='small' startIcon={<AddIcon />} onClick={() => setDialog({ id: null, key: '', value: '' })}>
            Create
          </Button>
        </Box>
      </Can>
      <ListContextProvider value={listContext}>
        <Datagrid size='medium' rowClick={false} bulkActionButtons={false}>
          <FunctionField label='Name' sortable={false} render={(t: Tag) => t.key} />

          <FunctionField
            label='Value'
            sortable={false}
            render={(t: Tag) => {
              const value = t.value ?? '';
              return <CopyChip title={value} label={value.length > 40 ? `${value.slice(0, 40)}...` : value} />;
            }}
          />

          <Toolbar>
            <WithRecord
              render={(t: Tag) => (
                <>
                  <Can cap='device.tags.write'>
                    <Button
                      aria-label='edit tag'
                      variant='outlined'
                      size='small'
                      onClick={() => setDialog({ id: t.id, key: t.key, value: t.value })}
                    >
                      <EditIcon fontSize='small' />
                    </Button>
                  </Can>
                  <Can cap='device.tags.delete'>
                    <Button
                      aria-label='delete tag'
                      variant='outlined'
                      size='small'
                      onClick={() => void call(`${base}/${t.id}`, { method: 'DELETE' })}
                    >
                      <DeleteIcon fontSize='small' />
                    </Button>
                  </Can>
                </>
              )}
            />
          </Toolbar>
        </Datagrid>
      </ListContextProvider>
      <Dialog open={!!dialog} onClose={() => setDialog(null)}>
        <DialogTitle>{dialog?.id === null ? 'Create Device Tag' : 'Edit Device Tag'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <MuiTextField
            label='Name'
            size='small'
            value={dialog?.key ?? ''}
            disabled={dialog?.id !== null}
            onChange={(e) => setDialog((d) => d && { ...d, key: e.target.value })}
          />
          <MuiTextField label='Value' size='small' value={dialog?.value ?? ''} onChange={(e) => setDialog((d) => d && { ...d, value: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant='contained' disabled={!dialog?.key.trim()} onClick={() => void save()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CustomerTagsWidget;
