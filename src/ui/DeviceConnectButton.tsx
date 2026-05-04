import React from 'react';
import { Grid, Button, Dialog, DialogTitle, DialogContent } from '@mui/material';
import type { ButtonProps, SxProps, Theme } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import ConnectIcon from '@mui/icons-material/Sensors';
import CloseIcon from '@mui/icons-material/Close';
import Tooltip from '@mui/material/Tooltip';
import DeviceConnect from './DeviceConnect';
import { ConfirmationDialog } from './ConfirmationDialog';
import { useRecordContext } from 'react-admin';
import type { ResourceRecord } from '../types/resource';

const styles: {
  dialog: SxProps<Theme>;
  dialogContent: SxProps<Theme>;
} = {
  dialog: {
    'width': '100%',
    'maxWidth': 'none',
    '& .MuiPaper-root': {
      maxWidth: 'none',
      width: '100%',
      height: '80vh',
    },
  },
  dialogContent: {
    maxWidth: 'none',
    display: 'flex',
    flexDirection: 'column',
  },
};

interface DeviceConnectButtonProps extends Omit<ButtonProps, 'children' | 'onClick'> {
  record?: ResourceRecord;
  connectIcon?: React.ReactNode;
  connectIconTooltip?: React.ReactNode;
  label?: React.ReactNode;
}

export const DeviceConnectButton: React.FC<DeviceConnectButtonProps> = ({
  record: recordProp,
  connectIcon,
  connectIconTooltip = 'Connect',
  label,
  ...buttonProps
}) => {
  const [open, setOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const contextRecord = useRecordContext<ResourceRecord>();
  const record = contextRecord ?? recordProp;
  const icon = connectIcon ?? <ConnectIcon />;

  const handleConfirmClose = () => {
    setOpen(false);
    setConfirmOpen(false);
  };

  const handleRequestClose = () => {
    setConfirmOpen(true);
  };

  if (!record) {
    return null;
  }

  const ipAddress = (record['ip address'] as string | undefined) ?? '';
  const ipv4Regex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
  const ipv4Addresses = ipAddress.match(ipv4Regex) ?? [];

  return (
    <>
      <Tooltip title={connectIconTooltip}>
        <Button aria-label='connect' onClick={() => setOpen(true)} startIcon={icon} {...buttonProps}>
          {label ?? null}
        </Button>
      </Tooltip>
      <Dialog open={open} onClose={handleRequestClose} sx={styles.dialog}>
        <DialogTitle id='form-dialog-title'>
          <Grid container sx={{ justifyContent: 'space-between' }}>
            <span style={{ whiteSpace: 'nowrap' }}>
              {record['device name']?.trim()} (
                {ipv4Addresses[0] ? (
                  <a
                    href={`http://${ipv4Addresses[0].trim()}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#1976d2',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                  >
                    {ipv4Addresses[0].trim()}
                  </a>
                ) : null}
              )
            </span>
            <IconButton onClick={handleRequestClose} size='large'>
              <CloseIcon />
            </IconButton>
          </Grid>
        </DialogTitle>
        <DialogContent sx={styles.dialogContent}>
          <DeviceConnect record={record} />
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={confirmOpen}
        title='Close connection?'
        content='Closing this window will end your remote session.'
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmClose}
        confirmButtonText='Close'
      />
    </>
  );
};

export default DeviceConnectButton;
