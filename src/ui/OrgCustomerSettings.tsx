import { Box, MenuItem, TextField as MuiTextField } from '@mui/material';
import * as React from 'react';
import { useController, useFormContext } from 'react-hook-form';
import { useGetList, useNotify, useRecordContext } from 'react-admin';
import {
  adminFetch,
  apiMessage,
  isOrgSettings,
  OrgSettings,
  OrgSettingsChoice,
  toSettingsChoice,
} from '../lib/adminApi';

export const SETTINGS_FIELD = 'customerSettings';

export type OrgSettingsState = {
  status: 'loading' | 'error' | 'ready';
  settings: OrgSettings | null;
  reload: () => void;
};

export const OrgSettingsContext = React.createContext<OrgSettingsState>({
  status: 'loading',
  settings: null,
  reload: () => {},
});

// Loads the org's customer settings once and exposes them to the field and to the form's save.
export const OrgSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const record = useRecordContext<{ id: number }>();
  const notify = useNotify();
  const [state, setState] = React.useState<Omit<OrgSettingsState, 'reload'>>({ status: 'loading', settings: null });
  const [tick, setTick] = React.useState(0);
  const reload = React.useCallback(() => setTick((t) => t + 1), []);

  React.useEffect(() => {
    if (!record?.id) return;
    let cancelled = false;
    setState({ status: 'loading', settings: null });
    void (async () => {
      const r = await adminFetch(`/api/admin/orgs/${record.id}/settings`);
      if (cancelled) return;
      if (!r.ok || !isOrgSettings(r.body)) {
        setState({ status: 'error', settings: null });
        notify(apiMessage(r.body, 'Could not load customer settings'), { type: 'error' });
        return;
      }
      setState({ status: 'ready', settings: r.body });
    })();
    return () => {
      cancelled = true;
    };
  }, [record?.id, tick]);

  const value = React.useMemo(() => ({ ...state, reload }), [state, reload]);
  return <OrgSettingsContext.Provider value={value}>{children}</OrgSettingsContext.Provider>;
};

// Customer permission set as a field of the org form; saved by the form's own Save.
const OrgCustomerSettings: React.FC = () => {
  const record = useRecordContext<{ id: number }>();
  const { status, settings } = React.useContext(OrgSettingsContext);
  const { data: sets = [] } = useGetList('permission-sets', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });
  const {
    field: { value, onChange },
  } = useController({ name: SETTINGS_FIELD });
  const { setValue } = useFormContext();

  // Seeds the field from the loaded settings; without them the field stays empty (no settings change is sent).
  // Re-seeds whenever the field is empty (a record-driven form reset clears it).
  const choice = value as OrgSettingsChoice | undefined;
  React.useEffect(() => {
    if (settings && choice === undefined) setValue(SETTINGS_FIELD, toSettingsChoice(settings), { shouldDirty: false });
  }, [settings, choice, setValue]);

  if (!record?.id) return null;
  return (
    <Box sx={{ my: 3 }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>Customer org</strong>
      {status !== 'ready' || !choice ? (
        <Box sx={{ color: 'text.secondary' }}>
          {status === 'error' ? 'Could not load — reload the page' : 'Loading…'}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <MuiTextField
            select
            label='Customer permission set'
            helperText='Choosing a set makes this org selectable for customer users.'
            value={choice.permissionSetId}
            onChange={(e) => onChange({ permissionSetId: e.target.value })}
            sx={{ minWidth: 320 }}
          >
            <MenuItem value=''>— not a customer org —</MenuItem>
            {sets
              .filter((s) => !(s.capabilities ?? []).includes('admin'))
              .map((s) => (
                <MenuItem key={s.id} value={String(s.id)}>
                  {s.name}
                </MenuItem>
              ))}
          </MuiTextField>
          <span>{settings?.userCount ?? 0} users</span>
        </Box>
      )}
    </Box>
  );
};

export default OrgCustomerSettings;
