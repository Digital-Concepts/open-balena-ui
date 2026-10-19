import { Box, useTheme } from '@mui/material';
import * as React from 'react';
import { Form, SelectInput, useNotify, useRecordContext } from 'react-admin';
import ssh from 'micro-key-producer/ssh.js';
import { randomBytes } from 'micro-key-producer/utils.js';
import environment from '../../lib/reactAppEnv';
import { EmbeddedFrame } from '../../ui/EmbeddedFrame';
import { customerApi } from '../api';

type ConnectInfo = { uuid: string; username: string; containers: string[] };

const HOST = '__host__';

// Same connect card as the admin DeviceConnect (host and container SSH), fed from the customer API.
const CustomerDeviceConnect: React.FC<{ record?: Record<string, any> }> = ({ record: recordProp }) => {
  const contextRecord = useRecordContext<{ uuid: string }>();
  const record = (contextRecord ?? recordProp) as { uuid: string } | undefined;
  const notify = useNotify();
  const theme = useTheme();
  const [info, setInfo] = React.useState<ConnectInfo | null>(null);
  const [iframeUrl, setIframeUrl] = React.useState('');

  const logsPalette = theme.palette.logs;
  const logsBgColor = logsPalette?.background ?? (theme.palette.mode === 'dark' ? '#0d1a26' : '#343434');

  React.useEffect(() => {
    if (!record?.uuid) return;
    customerApi<ConnectInfo>(`/devices/${record.uuid}/connect`)
      .then(setInfo)
      .catch((e) => notify((e as Error).message, { type: 'error' }));
  }, [record?.uuid, notify]);

  const choices = React.useMemo(
    () => [
      { label: 'host - SSH', value: HOST },
      ...(info?.containers ?? []).map((c) => ({ label: `${c} - SSH`, value: c })),
    ],
    [info],
  );

  const handleSubmit = (input: unknown): void => {
    const target = typeof input === 'string' ? input : '';
    if (!info || !target || target === 'default') return;
    void (async () => {
      try {
        const { publicKey, privateKey } = ssh(randomBytes(32), 'open-balena-remote');
        await customerApi('/ssh-key', { method: 'POST', body: JSON.stringify({ publicKey, deviceUuid: info.uuid }) });
        const jwt = localStorage.getItem('auth') ?? '';
        const container = target === HOST ? '' : `&container=${encodeURIComponent(target)}`;
        setIframeUrl(
          `${environment.REACT_APP_OPEN_BALENA_REMOTE_URL ?? ''}?service=ssh${container}&uuid=${info.uuid}&jwt=${jwt}` +
            `&username=${encodeURIComponent(info.username)}&privateKey=${encodeURIComponent(privateKey)}`,
        );
      } catch (e) {
        notify((e as Error).message, { type: 'error' });
      }
    })();
  };

  if (!record) return null;

  return (
    <>
      <Form onSubmit={handleSubmit}>
        <Box
          sx={{
            'display': 'flex',
            'padding': '5px 15px',
            'paddingRight': '70px',
            'alignItems': 'center',
            '.MuiFormHelperText-root, .MuiFormLabel-root': { display: 'none' },
            '.MuiOutlinedInput-root': { height: '35px' },
            '.MuiSelect-select': { padding: '9px 14px' },
          }}
        >
          <strong style={{ flex: 1 }}>Connect</strong>

          <SelectInput
            source='container'
            disabled={!info}
            choices={choices}
            defaultValue='default'
            emptyText='Select Service'
            emptyValue='default'
            optionText='label'
            optionValue='value'
            onChange={(event) => handleSubmit((event.target as HTMLInputElement).value)}
          />
        </Box>
      </Form>

      <EmbeddedFrame src={iframeUrl} backgroundColor={logsBgColor} />
    </>
  );
};

export default CustomerDeviceConnect;
