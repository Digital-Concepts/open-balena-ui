import { Box } from '@mui/material';
import * as React from 'react';
import { useController, useFormContext } from 'react-hook-form';
import { useNotify, useRecordContext } from 'react-admin';
import { Account, AccountChoice, adminFetch, apiMessage, isAccount, toChoice } from '../lib/adminApi';
import AccountTypeFields from './AccountTypeFields';
import { useCustomerOrgs } from '../lib/useCustomerOrgs';

export type AccountState = { status: 'loading' | 'error' | 'ready'; account: Account | null; reload: () => void };

export const UserAccountContext = React.createContext<AccountState>({
  status: 'loading',
  account: null,
  reload: () => {},
});

// Loads the user's account once and exposes it to the panel and the advanced section.
export const UserAccountProvider: React.FC<{ userId?: number | string; children: React.ReactNode }> = ({
  userId,
  children,
}) => {
  const notify = useNotify();
  const [state, setState] = React.useState<Omit<AccountState, 'reload'>>({ status: 'loading', account: null });
  const [tick, setTick] = React.useState(0);
  const reload = React.useCallback(() => setTick((t) => t + 1), []);

  React.useEffect(() => {
    if (userId == null) return;
    let cancelled = false;
    setState({ status: 'loading', account: null });
    void (async () => {
      const r = await adminFetch(`/api/admin/users/${userId}/account`);
      if (cancelled) return;
      if (!r.ok || !isAccount(r.body)) {
        setState({ status: 'error', account: null });
        notify(apiMessage(r.body, 'Could not load account type'), { type: 'error' });
        return;
      }
      setState({ status: 'ready', account: r.body });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, tick]);

  const value = React.useMemo(() => ({ ...state, reload }), [state, reload]);
  return <UserAccountContext.Provider value={value}>{children}</UserAccountContext.Provider>;
};

export const ACCOUNT_FIELD = 'accountChoice';

// Account type chooser as a field of the user form; saved by the form's own Save (see UserEdit).
const UserAccountType: React.FC = () => {
  const record = useRecordContext<{ id: number }>();
  const { status, account } = React.useContext(UserAccountContext);
  const customerOrgs = useCustomerOrgs();
  const {
    field: { value, onChange },
    fieldState: { error },
  } = useController({
    name: ACCOUNT_FIELD,
    rules: {
      validate: (v: AccountChoice | undefined) =>
        v?.type === 'customer' && v.orgId === '' ? 'Select a customer org' : true,
    },
  });
  const { setValue } = useFormContext();

  // Seeds the field from the loaded account; without a ready account the field stays empty (no account change is sent).
  // Re-seeds whenever the field is empty (a record-driven form reset clears it).
  const choice = value as AccountChoice | undefined;
  React.useEffect(() => {
    if (account && choice === undefined) setValue(ACCOUNT_FIELD, toChoice(account), { shouldDirty: false });
  }, [account, choice, setValue]);

  const loaded = status === 'ready' && choice != null;

  if (!record?.id) return null;
  return (
    <Box sx={{ my: 3 }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>Account type</strong>
      {loaded ? (
        <>
          <AccountTypeFields customerOrgs={customerOrgs} value={choice} onChange={onChange} />
          {error && <Box sx={{ color: 'error.main', mt: 1 }}>{error.message}</Box>}
        </>
      ) : (
        <Box sx={{ color: 'text.secondary' }}>
          {status === 'error' ? 'Could not load — reload the page' : 'Loading…'}
        </Box>
      )}
    </Box>
  );
};

export default UserAccountType;
