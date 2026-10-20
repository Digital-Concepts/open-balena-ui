import * as React from 'react';
import { Datagrid, FunctionField, Link, List, Pagination, SelectInput, TextField, downloadCSV, useCreatePath, useGetList, useListContext } from 'react-admin';
import jsonExport from 'jsonexport/dist';
import { Box, Tooltip } from '@mui/material';
import { adminFetch } from '../lib/adminApi';
import { auditActionLabel } from '../lib/auditActions';

type AuditRow = {
  id: number;
  ts: string;
  username: string | null;
  orgName: string | null;
  fleetName: string | null;
  deviceUuid: string | null;
  deviceName: string | null;
  action: string;
  details: Record<string, unknown> | null;
  result: 'ok' | 'failed';
  error: string | null;
};

type FilterValues = { users: { id: number; username: string }[]; fleets: { id: number; name: string }[]; actions: string[] };

const formatTime = (ts: string): string => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
};

// Customer-controlled text (tag keys, file names) must not start a spreadsheet formula.
export const csvSafe = (v: unknown): unknown =>
  typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;

export const toCsvRows = (rows: AuditRow[]) =>
  rows.map((r) =>
    Object.fromEntries(
      Object.entries({
        time: r.ts,
        user: r.username,
        org: r.orgName,
        fleet: r.fleetName,
        device: r.deviceName,
        deviceUuid: r.deviceUuid,
        action: r.action,
        details: formatDetails(r.details),
        result: r.result,
        error: r.error,
      }).map(([k, v]) => [k, csvSafe(v)]),
    ),
  );

const auditExporter = (rows: AuditRow[]) =>
  jsonExport(toCsvRows(rows), (err: unknown, csv: string) => {
    if (err) {
      console.error('Audit export failed', err);
      return;
    }
    downloadCSV(csv, `audit-${new Date().toISOString().split('T')[0]}`);
  });

export const formatDetails = (details: Record<string, unknown> | null): string =>
  details
    ? Object.entries(details)
        .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
        .join(', ')
    : '';

const DeviceCell: React.FC<{ row: AuditRow; ids: Record<string, number> }> = ({ row, ids }) => {
  const createPath = useCreatePath();
  const label = row.deviceName ?? row.deviceUuid ?? '';
  const id = row.deviceUuid ? ids[row.deviceUuid] : undefined;
  if (id === undefined) return <>{label}</>;
  return <Link to={createPath({ resource: 'device', type: 'show', id })}>{label}</Link>;
};

const AuditGrid: React.FC = () => {
  const { data } = useListContext<AuditRow>();
  const uuids = React.useMemo(
    () => [...new Set((data ?? []).map((r) => r.deviceUuid).filter((u): u is string => !!u))],
    [data],
  );
  const { data: devices } = useGetList(
    'device',
    { pagination: { page: 1, perPage: Math.max(uuids.length, 1) }, filter: { 'uuid@in': `(${uuids.join(',')})` } },
    { enabled: uuids.length > 0 },
  );
  const ids = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of devices ?? []) m[(d as any).uuid] = (d as any).id;
    return m;
  }, [devices]);

  return (
    <Datagrid size='medium' rowClick={false} bulkActionButtons={false}>
      <FunctionField<AuditRow> label='Time' sortable={false} render={(r) => formatTime(r.ts)} />
      <TextField source='username' label='User' sortable={false} />
      <TextField source='orgName' label='Org' sortable={false} />
      <TextField source='fleetName' label='Fleet' sortable={false} />
      <FunctionField<AuditRow> label='Device' sortable={false} render={(r) => <DeviceCell row={r} ids={ids} />} />
      <FunctionField<AuditRow> label='Action' sortable={false} render={(r) => auditActionLabel(r.action)} />
      <FunctionField<AuditRow> label='Details' sortable={false} render={(r) => formatDetails(r.details)} />
      <FunctionField<AuditRow>
        label='Result'
        sortable={false}
        render={(r) =>
          r.result === 'ok' ? (
            <Box component='span' aria-label='ok' sx={{ color: 'success.main', fontWeight: 700 }}>✔</Box>
          ) : (
            <Tooltip title={r.error ?? 'failed'}>
              <Box component='span' aria-label='failed' sx={{ color: 'error.main', fontWeight: 700, cursor: 'help' }}>✖</Box>
            </Tooltip>
          )
        }
      />
    </Datagrid>
  );
};

export const AuditList: React.FC = () => {
  const [values, setValues] = React.useState<FilterValues>({ users: [], fleets: [], actions: [] });
  React.useEffect(() => {
    let active = true;
    void adminFetch('/api/admin/audit/filters')
      .then((r) => {
        if (active && r.ok && r.body) setValues({ users: r.body.users ?? [], fleets: r.body.fleets ?? [], actions: r.body.actions ?? [] });
      })
      .catch((e) => console.error('audit filters', e));
    return () => {
      active = false;
    };
  }, []);

  const filters = [
    <SelectInput key='userId' source='userId' label='User' alwaysOn choices={values.users} optionText='username' optionValue='id' />,
    <SelectInput
      key='action'
      source='action'
      label='Action'
      alwaysOn
      choices={values.actions.map((a) => ({ id: a, name: auditActionLabel(a) }))}
    />,
    <SelectInput key='fleetId' source='fleetId' label='Fleet' alwaysOn choices={values.fleets} optionText='name' optionValue='id' />,
  ];

  return (
    <List
      resource='audit'
      title='Audit'
      filters={filters}
      perPage={25}
      sort={{ field: 'ts', order: 'DESC' }}
      exporter={auditExporter}
      pagination={<Pagination rowsPerPageOptions={[25, 50, 100]} />}
    >
      <AuditGrid />
    </List>
  );
};

export default { list: AuditList };
