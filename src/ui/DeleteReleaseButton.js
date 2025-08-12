import DeleteIcon from '@mui/icons-material/Delete';
import { Button } from '@mui/material';
import React from 'react';
import { useNotify, useRecordContext, useRedirect } from 'react-admin';
import { useDeleteRelease, useDeleteReleaseBulk } from '../lib/release';
import versions from '../versions';
import environment from '../lib/reactAppEnv';
import { ConfirmationDialog } from './ConfirmationDialog';

const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);

export const DeleteReleaseButton = ({ selectedIds, context, ...props }) => {
  const [open, setOpen] = React.useState(false);
  const notify = useNotify();
  const redirect = useRedirect();
  const deleteRelease = useDeleteRelease();
  const deleteReleaseBulk = useDeleteReleaseBulk();
  const [disabled, setDisabled] = React.useState(true);
  const record = useRecordContext();

  const handleSubmit = async () => {
    try {
      const idsToDelete = selectedIds || [record.id];
      
      for (const releaseId of idsToDelete) {
        // Check for image install records
        const imageInstallResult = await context.getList('image install', {
          pagination: { page: 1, perPage: 1000 },
          sort: { field: 'id', order: 'ASC' },
          filter: { 'is provided by-release': releaseId },
        });
        
        // If there are image installs, delete them first
        if (imageInstallResult.data.length > 0) {
          const imageInstallIds = imageInstallResult.data.map(install => install.id);
          await context.deleteMany('image install', { ids: imageInstallIds });
          console.log(`Deleted ${imageInstallResult.data.length} image install records for release ${releaseId}`);
        }
      }
      
      // Now proceed with original deletion logic
      if (selectedIds) {
        await deleteReleaseBulk(selectedIds);
      } else {
        await deleteRelease(record);
      }
      
      setOpen(false);
      notify('Release(s) and associated records successfully deleted', { type: 'success' });
      redirect(props.redirect);
      
    } catch (error) {
      setOpen(false);
      notify(`Failed to delete release: ${error.message}`, { type: 'error' });
      console.error('Delete release error:', error);
    }
  };

  React.useEffect(() => {
    const canDeleteRelease = async (releaseId) => {
      let releaseLookups = [
        { resource: 'device', field: `#is running-release,${isPinnedOnRelease},should be operated by-release@eq` },
        { resource: 'application', field: 'should be running-release' },
      ];
      let count = 0;
      await Promise.all(
        releaseLookups.map((lookup) => {
          return context
            .getList(lookup.resource, {
              pagination: { page: 1, perPage: 1000 },
              sort: { field: 'id', order: 'ASC' },
              filter: { [lookup.field]: releaseId },
            })
            .then((result) => {
              count += result.data.length;
            });
        }),
      );
      return count === 0;
    };
    if (selectedIds) {
      Promise.all(selectedIds.map((id) => canDeleteRelease(id))).then((canDeleteResults) =>
        setDisabled(!canDeleteResults.every((canDelete) => canDelete)),
      );
    } else if (record && record.id) {
      canDeleteRelease(record.id).then((canDelete) => setDisabled(!canDelete));
    }
  }, [selectedIds, context]);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={props.variant || 'contained'}
        color='error'
        size={props.size}
        sx={props.sx}
        disabled={disabled}
      >
        <DeleteIcon sx={{ mr: '4px' }} size={props.size} /> {props.children}
      </Button>

      <ConfirmationDialog
        open={open}
        title='Delete Release(s)'
        content='This will delete the release and any associated installation records. This action cannot be undone.'
        onConfirm={handleSubmit}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

export default DeleteReleaseButton;
