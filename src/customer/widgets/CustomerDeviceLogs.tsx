import { Box, useTheme } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import * as React from 'react';
import { Form, SelectInput, useNotify, useRecordContext } from 'react-admin';
import { EmbeddedFrame } from '../../ui/EmbeddedFrame';
import { customerApi } from '../api';

type Service = { serviceId: number; serviceName: string; status: string };
type Log = { message: string; timestamp: number; serviceId: number | null; isStderr: boolean; isSystem: boolean };

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const formatTime = (ts: number) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString();
};

// Same logs card as the admin DeviceLogs, fed from the customer API.
const CustomerDeviceLogs: React.FC = () => {
  const record = useRecordContext<{ uuid: string }>();
  const notify = useNotify();
  const theme = useTheme();
  const [logs, setLogs] = React.useState<Log[]>([]);
  const [containers, setContainers] = React.useState<{ id: number; name: string }[]>([]);
  const [container, setContainer] = React.useState<number | 'default'>('default');

  const logsPalette = theme.palette.logs;
  const logsBgColor = logsPalette?.background ?? (theme.palette.mode === 'dark' ? '#0d1a26' : '#343434');
  const logsTextColor = logsPalette?.text?.default ?? '#eeeeee';
  const logsErrorColor = logsPalette?.text?.error ?? '#ee6666';
  const logsWarningColor = logsPalette?.text?.warning ?? '#ffee66';

  const emptyLogsHtml = React.useMemo(
    () =>
      `<html><body style='font-family: consolas; color: ${logsTextColor}; background-color: ${logsBgColor}; margin: 0; padding: 10px;'></body></html>`,
    [logsBgColor, logsTextColor],
  );

  const loadLogs = React.useCallback(async () => {
    if (!record?.uuid) return;
    try {
      setLogs(await customerApi<Log[]>(`/devices/${record.uuid}/logs`));
    } catch (error) {
      console.error(error);
      notify(`Error: Could not get logs for device ${record.uuid}`, { type: 'error' });
    }
  }, [record?.uuid, notify]);

  React.useEffect(() => {
    if (!record?.uuid) return;
    customerApi<Service[]>(`/devices/${record.uuid}/services`)
      .then((services) => {
        const choices = [{ id: 0, name: 'host' }];
        for (const s of services) {
          if (s.status === 'Running' && !choices.some((c) => c.id === s.serviceId)) choices.push({ id: s.serviceId, name: s.serviceName });
        }
        setContainers(choices);
      })
      .catch((error) => {
        console.error(error);
        setContainers([{ id: 0, name: 'host' }]);
      });
  }, [record?.uuid]);

  React.useEffect(() => {
    if (container !== 'default') void loadLogs();
  }, [container, loadLogs]);

  const content = React.useMemo(() => {
    if (container === 'default') return '';
    const filtered = logs.filter((l) => (container === 0 ? l.serviceId === null : l.serviceId === container));
    if (!filtered.length) return '';
    const formatted = filtered
      .map((entry) => {
        const time = formatTime(entry.timestamp);
        const message = escapeHtml(entry.message);
        if (entry.isStderr) return `[${time}] <span style="color: ${logsErrorColor}; ">${message}</span>`;
        if (entry.isSystem) return `[${time}] <span style="color: ${logsWarningColor}; ">${message}</span>`;
        return `[${time}] ${message}`;
      })
      .join('<br/>');
    return `<html>
          <body style='font-family: consolas; color: ${logsTextColor}; background-color: ${logsBgColor}; margin: 0; padding: 10px;'>
            <div>${formatted}</div>
            <script>window.scrollTo(0, document.body.scrollHeight);</script>
          </body>
        </html>`;
  }, [container, logs, logsBgColor, logsTextColor, logsErrorColor, logsWarningColor]);

  if (!record) return null;

  return (
    <>
      <Form>
        <Box
          sx={{
            'display': 'flex',
            'padding': '5px 15px',
            'alignItems': 'center',
            '.MuiFormHelperText-root, .MuiFormLabel-root': { display: 'none' },
            '.MuiOutlinedInput-root': { height: '35px' },
            '.MuiSelect-select': { padding: '9px 14px' },
          }}
        >
          <strong style={{ flex: 1 }}>Logs</strong>

          <SelectInput
            source='container'
            disabled={containers.length === 0}
            choices={containers}
            defaultValue='default'
            emptyText='Select Container'
            emptyValue='default'
            size='small'
            label=''
            onChange={(event) => {
              const numeric = Number(event.target.value);
              setContainer(event.target.value === 'default' || Number.isNaN(numeric) ? 'default' : numeric);
            }}
          />

          <IconButton aria-label='refresh logs' disabled={container === 'default'} size='small' sx={{ ml: '10px' }} onClick={() => void loadLogs()}>
            <RefreshIcon />
          </IconButton>
        </Box>
      </Form>

      <EmbeddedFrame srcDoc={content || emptyLogsHtml} backgroundColor={logsBgColor} />
    </>
  );
};

export default CustomerDeviceLogs;
