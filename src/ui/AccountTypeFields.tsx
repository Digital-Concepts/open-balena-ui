import { Box, FormControlLabel, MenuItem, Radio, RadioGroup, TextField as MuiTextField } from '@mui/material';
import * as React from 'react';
import { useGetList } from 'react-admin';
import type { AccountChoice } from '../lib/adminApi';
import type { CustomerOrgs } from '../lib/useCustomerOrgs';

// Controlled account-type chooser: Customer (customer orgs only) or Internal (permission set).
export const AccountTypeFields: React.FC<{
  value: AccountChoice;
  onChange: (v: AccountChoice) => void;
  customerOrgs: CustomerOrgs;
  disabled?: boolean;
}> = ({ value, onChange, customerOrgs, disabled }) => {
  const { data: sets = [] } = useGetList('permission-sets', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });
  const orgsReady = customerOrgs.status === 'ready';

  return (
    <Box>
      <RadioGroup
        row
        value={value.type}
        onChange={(e) => onChange({ ...value, type: e.target.value as AccountChoice['type'] })}
      >
        <FormControlLabel value='customer' control={<Radio disabled={disabled} />} label='Customer' />
        <FormControlLabel value='internal' control={<Radio disabled={disabled} />} label='Internal' />
      </RadioGroup>
      {value.type === 'customer' ? (
        <MuiTextField
          select
          disabled={disabled || !orgsReady}
          helperText={
            customerOrgs.status === 'loading'
              ? 'Loading…'
              : customerOrgs.status === 'error'
                ? 'Could not load customer orgs — reload the page'
                : customerOrgs.orgs.length === 0
                  ? 'No customer orgs — assign a customer permission set on an organization page'
                  : undefined
          }
          label='Customer org'
          value={value.orgId}
          onChange={(e) => onChange({ ...value, orgId: e.target.value })}
          sx={{ minWidth: 320 }}
        >
          {value.orgId !== '' && !customerOrgs.orgs.some((o) => String(o.id) === value.orgId) && (
            <MenuItem value={value.orgId}>{`org ${value.orgId}`}</MenuItem>
          )}
          {customerOrgs.orgs.map((o) => (
            <MenuItem key={o.id} value={String(o.id)}>
              {o.name}
            </MenuItem>
          ))}
        </MuiTextField>
      ) : (
        <MuiTextField
          select
          disabled={disabled}
          label='Admin UI permission set'
          value={value.permissionSetId}
          onChange={(e) => onChange({ ...value, permissionSetId: e.target.value })}
          sx={{ minWidth: 320 }}
        >
          <MenuItem value=''>— none (no access) —</MenuItem>
          {value.permissionSetId !== '' && !sets.some((x) => String(x.id) === value.permissionSetId) && (
            <MenuItem value={value.permissionSetId}>{`set ${value.permissionSetId}`}</MenuItem>
          )}
          {sets.map((s) => (
            <MenuItem key={s.id} value={String(s.id)}>
              {s.name}
            </MenuItem>
          ))}
        </MuiTextField>
      )}
    </Box>
  );
};

export default AccountTypeFields;
