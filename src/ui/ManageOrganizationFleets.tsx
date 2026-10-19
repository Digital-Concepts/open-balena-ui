import React from 'react';
import { Box } from '@mui/material';
import {
  Confirm,
  Identifier,
  Loading,
  RaRecord,
  SimpleForm,
  useDataProvider,
  useGetList,
  useNotify,
  useRecordContext,
  useRedirect,
  useResourceContext,
  useSaveContext,
} from 'react-admin';
import { useFormContext, useWatch } from 'react-hook-form';
import GenericTransferList, { TransferListOption } from '../components/genericTransferList';
import { diffFleetSelection, FleetSelectionDiff } from '../lib/orgFleets';
import { apiMessage, OrgSettingsChoice, putOrgSettings, settingsChanged } from '../lib/adminApi';
import { OrgSettingsContext, SETTINGS_FIELD } from './OrgCustomerSettings';

export const FLEET_FIELD = 'fleetArray';

interface FleetRecord extends RaRecord {
  'app name': string;
  'organization': Identifier | null;
}

interface OrganizationRecord extends RaRecord {
  name: string;
}

interface FleetData {
  fleets: FleetRecord[];
  orgNames: Map<string, string>;
  isLoading: boolean;
  isFetching: boolean;
  seed: { key: number; fleets: FleetRecord[] | null };
}

const FleetDataContext = React.createContext<FleetData>({
  fleets: [],
  orgNames: new Map(),
  isLoading: true,
  isFetching: true,
  seed: { key: 0, fleets: null },
});

const listParams = {
  pagination: { page: 1, perPage: 1000 },
  sort: { field: 'id', order: 'ASC' } as const,
  filter: {},
};

const ManageOrganizationFleets: React.FC = () => {
  const record = useRecordContext<RaRecord>();
  const { setValue } = useFormContext();
  const selection = (useWatch({ name: [FLEET_FIELD] })[0] as Identifier[] | undefined) ?? [];
  const { fleets: liveFleets, orgNames, isLoading, isFetching, seed } = React.useContext(FleetDataContext);
  const fleets = liveFleets;
  const seededKey = React.useRef<string | null>(null);

  // Seeds the selection from fresh data; after a save it reseeds from the explicitly refetched list.
  React.useEffect(() => {
    const key = `${record?.id}:${seed.key}`;
    if (seededKey.current === key || record?.id == null) return;
    const source = seed.key > 0 ? seed.fleets : !isLoading && !isFetching ? liveFleets : null;
    if (!source) return;
    const own = source.filter((f) => String(f.organization) === String(record.id)).map((f) => f.id);
    setValue(FLEET_FIELD, own, { shouldDirty: false });
    seededKey.current = key;
  }, [isLoading, isFetching, liveFleets, record?.id, seed, setValue]);

  const options = React.useMemo<TransferListOption[]>(
    () =>
      fleets.map((f) => {
        const foreign = f.organization != null && String(f.organization) !== String(record?.id);
        const owner = foreign ? (orgNames.get(String(f.organization)) ?? `org ${f.organization}`) : null;
        return { id: f.id, label: owner ? `${f['app name']} (${owner})` : f['app name'] };
      }),
    [fleets, orgNames, record?.id],
  );

  if (isLoading || isFetching) return <Loading />;

  return (
    <Box sx={{ width: 800, maxWidth: '100%' }}>
      <strong style={{ margin: '40px 0 10px', display: 'block' }}>Fleets</strong>
      <GenericTransferList
        options={options}
        value={selection}
        onChange={(next) => setValue(FLEET_FIELD, next, { shouldDirty: true })}
        availableLabel='Available'
        selectedLabel='Selected'
        listWidth={320}
        listHeight={360}
      />
    </Box>
  );
};

// Org edit form: every submit (button or Enter) is gated here. Order: confirm fleets leaving
// another org, save the org, then the customer settings (if changed), then move the fleets;
// any failure keeps the user on the page.
export const OrganizationFleetsForm: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const record = useRecordContext<RaRecord>();
  const saveContext = useSaveContext();
  const orgSettings = React.useContext(OrgSettingsContext);
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const redirect = useRedirect();
  const resource = useResourceContext();
  const fleetsQuery = useGetList<FleetRecord>('application', listParams);
  const orgsQuery = useGetList<OrganizationRecord>('organization', listParams);
  const [seed, setSeed] = React.useState<FleetData['seed']>({ key: 0, fleets: null });
  const [pending, setPending] = React.useState<{ values: any; diff: FleetSelectionDiff } | null>(null);

  const fleets = React.useMemo(() => fleetsQuery.data ?? [], [fleetsQuery.data]);
  const orgNames = React.useMemo(() => {
    const names = new Map<string, string>();
    (orgsQuery.data ?? []).forEach((o) => names.set(String(o.id), o.name));
    return names;
  }, [orgsQuery.data]);
  const data = React.useMemo<FleetData>(
    () => ({
      fleets,
      orgNames,
      isLoading: fleetsQuery.isLoading || orgsQuery.isLoading,
      isFetching: fleetsQuery.isFetching || orgsQuery.isFetching,
      seed,
    }),
    [fleets, orgNames, fleetsQuery.isLoading, fleetsQuery.isFetching, orgsQuery.isLoading, orgsQuery.isFetching, seed],
  );

  const fleetName = (id: Identifier) => fleets.find((f) => String(f.id) === String(id))?.['app name'] ?? String(id);

  const moveFleets = async (added: Identifier[]): Promise<string[]> => {
    const results = await Promise.allSettled(
      added.map((id) =>
        dataProvider.update('application', {
          id,
          data: { organization: record?.id },
          previousData: fleets.find((f) => String(f.id) === String(id)),
        }),
      ),
    );
    const failed = added.filter((_, i) => results[i].status === 'rejected').map(fleetName);
    const fresh = await fleetsQuery.refetch();
    const freshFleets = (fresh.data as unknown as { data?: FleetRecord[] } | undefined)?.data;
    setSeed((prev) => ({ key: prev.key + 1, fleets: freshFleets ?? fleets }));
    return failed;
  };

  const saveThenMove = async (values: any, added: Identifier[]) => {
    const { [FLEET_FIELD]: _fleetArray, [SETTINGS_FIELD]: settingsChoice, ...orgValues } = values;
    await saveContext?.save?.(orgValues, {
      onSuccess: async () => {
        const loaded = orgSettings.status === 'ready' ? orgSettings.settings : null;
        let settingsError: string | null = null;
        if (loaded && settingsChoice && settingsChanged(loaded, settingsChoice as OrgSettingsChoice)) {
          const r = await putOrgSettings(record!.id, settingsChoice as OrgSettingsChoice);
          if (!r.ok) settingsError = apiMessage(r.body, 'unknown error');
          orgSettings.reload();
        }
        const failedFleets = await moveFleets(added);
        if (settingsError != null && failedFleets.length > 0) {
          notify(
            `Org saved, but customer settings (${settingsError}) and fleet(s) ${failedFleets.join(', ')} were not saved.`,
            {
              type: 'error',
            },
          );
          return;
        }
        if (settingsError != null) {
          notify(`Org saved, but customer settings were not: ${settingsError}`, { type: 'error' });
          return;
        }
        if (failedFleets.length > 0) {
          notify(`Could not assign fleet(s): ${failedFleets.join(', ')}`, { type: 'error' });
          return;
        }
        notify('ra.notification.updated', { type: 'info', messageArgs: { smart_count: 1 } });
        redirect('list', resource);
      },
    });
  };

  const handleSubmit = async (values: any) => {
    if (record?.id == null) return;
    let selected: Identifier[] = values[FLEET_FIELD] ?? [];
    const { added, removed, foreign } = diffFleetSelection(fleets, selected, record.id);
    if (removed.length > 0) {
      notify('A fleet must belong to an org. Move it by assigning it to another org.', { type: 'warning' });
      selected = [...selected, ...removed];
    }
    const diff = { added, removed: [] as Identifier[], foreign };
    const nextValues = { ...values, [FLEET_FIELD]: selected };
    if (foreign.length > 0) {
      setPending({ values: nextValues, diff });
      return;
    }
    await saveThenMove(nextValues, added);
  };

  const lines = (pending?.diff.foreign ?? []).map(
    (f) => `${fleetName(f.id)} will leave ${orgNames.get(String(f.organization)) ?? `org ${f.organization}`}`,
  );

  return (
    <FleetDataContext.Provider value={data}>
      <SimpleForm onSubmit={handleSubmit}>
        {children}
        <ManageOrganizationFleets />
      </SimpleForm>
      <Confirm
        isOpen={pending != null}
        title='Move fleets between organizations'
        content={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        }
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) void saveThenMove(p.values, p.diff.added);
        }}
        onClose={() => setPending(null)}
      />
    </FleetDataContext.Provider>
  );
};

export default OrganizationFleetsForm;
