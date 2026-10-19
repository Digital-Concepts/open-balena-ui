import * as React from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useNotify, useRecordContext, useRedirect } from 'react-admin';
import { useQueryClient } from '@tanstack/react-query';
import { useWatch } from 'react-hook-form';
import {
  Create,
  Datagrid,
  Edit,
  EditButton,
  email,
  EmailField,
  FunctionField,
  List,
  PasswordInput,
  ReferenceField,
  ReferenceManyField,
  SaveButton,
  SimpleForm,
  SingleFieldList,
  TextField,
  TextInput,
  Toolbar,
  required,
  ToolbarProps,
  CreateProps,
  EditProps,
} from 'react-admin';
import { guardMappings, useCreateUser, useModifyUser, useUserCreated } from '../lib/user';
import ChangePasswordButton from '../ui/ChangePasswordButton';
import DeleteUserButton, { DeleteUserButtonProps } from '../ui/DeleteUserButton';
import ManageOrganizations from '../ui/ManageOrganizations';
import ManagePermissions from '../ui/ManagePermissions';
import ManageRoles from '../ui/ManageRoles';
import UserAccountType, {
  ACCOUNT_FIELD,
  AccountState,
  UserAccountContext,
  UserAccountProvider,
} from '../ui/UserAccountType';
import { useCustomerOrgs } from '../lib/useCustomerOrgs';
import AccountTypeFields from '../ui/AccountTypeFields';
import { AccountChoice, apiMessage, choiceChanged, putAccount } from '../lib/adminApi';
import {
  UserPermissionSetField,
  UserCustomerField,
  usePermissionSetLookup,
  PermissionSetLookupContext,
} from '../ui/UserPermissionSetField';
import Row from '../ui/Row';
import PasswordChecklist from 'react-password-checklist';

const CustomBulkActionButtons: React.FC<DeleteUserButtonProps> = (props) => (
  <React.Fragment>
    <DeleteUserButton variant='contained' size='small' {...props}>
      Delete Selected Users
    </DeleteUserButton>
  </React.Fragment>
);

export const UserList: React.FC = () => {
  const lookup = usePermissionSetLookup();
  return (
    <PermissionSetLookupContext.Provider value={lookup}>
      <List filter={{ 'username@neq': 'guest' }}>
        <Datagrid size='medium' rowClick={false} bulkActionButtons={<CustomBulkActionButtons />}>
          <TextField source='username' />
          <EmailField source='email' />

          <ReferenceManyField label='Organizations' source='id' reference='organization membership' target='user'>
            <SingleFieldList linkType={false}>
              <ReferenceField source='is member of-organization' reference='organization' target='id'>
                <TextField source='name' />
              </ReferenceField>
            </SingleFieldList>
          </ReferenceManyField>

          <ReferenceManyField label='Roles' source='id' reference='user-has-role' target='user'>
            <SingleFieldList linkType={false}>
              <ReferenceField source='role' reference='role' target='id'>
                <TextField source='name' />
              </ReferenceField>
            </SingleFieldList>
          </ReferenceManyField>

          <FunctionField
            label='Permission set'
            sortable={false}
            render={(r) => <UserPermissionSetField userId={r.id} />}
          />

          <FunctionField label='Customer' sortable={false} render={(r) => <UserCustomerField userId={r.id} />} />

          <Toolbar style={{ minHeight: 0, minWidth: 0, padding: 0, margin: 0, background: 0, textAlign: 'center' }}>
            <EditButton label='' size='small' variant='outlined' />
            <DeleteUserButton size='small' variant='outlined' />
          </Toolbar>
        </Datagrid>
      </List>
    </PermissionSetLookupContext.Provider>
  );
};

const CustomCreateToolbar: React.FC<ToolbarProps & { saveDisabled?: boolean }> = (props) => (
  <Toolbar {...props} style={{ justifyContent: 'space-between' }}>
    <SaveButton sx={{ flex: 1 }} disabled={props.saveDisabled} />
  </Toolbar>
);

export const UserCreate: React.FC<CreateProps> = (props) => {
  const createUser = useCreateUser();
  const [choice, setChoice] = React.useState<AccountChoice>({ type: 'internal', orgId: '', permissionSetId: '' });
  const choiceRef = React.useRef(choice);
  choiceRef.current = choice;
  const customerOrgs = useCustomerOrgs();
  const userCreated = useUserCreated(() => choiceRef.current);
  const [password, setPassword] = React.useState('');
  const [password_valid, setPasswordValid] = React.useState(false);

  return (
    <Create title='Create User' transform={createUser} mutationOptions={{ onSuccess: userCreated }} {...props}>
      <SimpleForm
        toolbar={
          <CustomCreateToolbar
            saveDisabled={
              !password_valid ||
              (choice.type === 'customer' && (customerOrgs.status !== 'ready' || choice.orgId === ''))
            }
          />
        }
      >
        <TextInput
          name='email'
          source='email'
          size='large'
          fullWidth={true}
          type='email'
          validate={[required(), email()]}
        />

        <Row>
          <TextInput name='username' source='username' validate={required()} size='large' fullWidth={true} />
          <PasswordInput
            name='password'
            source='password'
            validate={required()}
            size='large'
            fullWidth={true}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Row>

        <PasswordChecklist
          rules={['minLength', 'specialChar', 'number', 'capitalAndLowercase']}
          minLength={8}
          value={password}
          onChange={(isValid) => {
            setPasswordValid(isValid);
          }}
        />

        <Box sx={{ my: 2 }}>
          <strong style={{ display: 'block', marginBottom: 8 }}>Account type</strong>
          <AccountTypeFields customerOrgs={customerOrgs} value={choice} onChange={setChoice} />
        </Box>
      </SimpleForm>
    </Create>
  );
};

const CustomToolbar: React.FC<ToolbarProps & { alwaysEnableSaveButton?: boolean }> = ({
  alwaysEnableSaveButton,
  ...props
}) => (
  <Toolbar {...props} style={{ justifyContent: 'space-between' }}>
    <SaveButton alwaysEnable={alwaysEnableSaveButton} sx={{ flex: 1 }} />
    <DeleteUserButton variant='contained' size='large' sx={{ flex: 0.3, marginLeft: '40px' }}>
      Delete
    </DeleteUserButton>
  </Toolbar>
);

const ReadOnlyChips: React.FC<{
  label: string;
  reference: string;
  destField: string;
  destReference: string;
  nameField: string;
}> = ({ label, reference, destField, destReference, nameField }) => (
  <Box sx={{ my: 1 }}>
    <strong style={{ display: 'block', marginBottom: 4 }}>{label}</strong>
    <ReferenceManyField reference={reference} source='id' target='user'>
      <SingleFieldList linkType={false}>
        <ReferenceField source={destField} reference={destReference} target='id'>
          <TextField source={nameField} />
        </ReferenceField>
      </SingleFieldList>
    </ReferenceManyField>
  </Box>
);

// Customer mappings are owned by the server: shown read-only, never registered in the form.
export const AdvancedSection: React.FC = () => {
  const { status, account } = React.useContext(UserAccountContext);
  const chosen = useWatch({ name: ACCOUNT_FIELD }) as AccountChoice | undefined;
  const record = useRecordContext();
  let body: React.ReactNode;
  if (status !== 'ready' || !account) {
    body = <Box>{status === 'error' ? 'Could not load account type; editing is disabled.' : 'Loading…'}</Box>;
  } else if (account.type === 'customer' || chosen?.type === 'customer') {
    body = (
      <Box data-testid='advanced-readonly'>
        <Box sx={{ mb: 1 }}>Managed by the customer account type.</Box>
        <ReadOnlyChips
          label='Organizations'
          reference='organization membership'
          destField='is member of-organization'
          destReference='organization'
          nameField='name'
        />
        <ReadOnlyChips label='Roles' reference='user-has-role' destField='role' destReference='role' nameField='name' />
        <ReadOnlyChips
          label='Permissions'
          reference='user-has-permission'
          destField='permission'
          destReference='permission'
          nameField='name'
        />
      </Box>
    );
  } else {
    body = (
      <>
        <ManageOrganizations source='organizationArray' reference='organization membership' target='user' />
        <ManagePermissions source='permissionArray' reference='user-has-permission' target='user' />
        <ManageRoles source='roleArray' reference='user-has-role' target='user' />
      </>
    );
  }
  return (
    <Accordion disableGutters sx={{ my: 2, width: '100%' }} key={record?.id}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>openBalena details (advanced)</AccordionSummary>
      <AccordionDetails>{body}</AccordionDetails>
    </Accordion>
  );
};

type ReportedAccount = AccountState & { userId?: number | string };

const AccountScope: React.FC<{
  accountRef: React.MutableRefObject<ReportedAccount | null>;
  children: React.ReactNode;
}> = ({ accountRef, children }) => {
  const record = useRecordContext<{ id: number }>();
  return (
    <UserAccountProvider userId={record?.id}>
      <AccountReporter accountRef={accountRef} />
      {children}
    </UserAccountProvider>
  );
};

const AccountReporter: React.FC<{ accountRef: React.MutableRefObject<ReportedAccount | null> }> = ({ accountRef }) => {
  const record = useRecordContext<{ id: number }>();
  accountRef.current = { ...React.useContext(UserAccountContext), userId: record?.id };
  return null;
};

// One Save: the user record first (pessimistic), then the account type if it changed.
export const UserEdit: React.FC<EditProps> = (props) => {
  const modifyUser = useModifyUser();
  const notify = useNotify();
  const redirect = useRedirect();
  const queryClient = useQueryClient();
  const accountRef = React.useRef<ReportedAccount | null>(null);
  const choiceRef = React.useRef<AccountChoice | null>(null);

  const transform = (data: any) => {
    const { [ACCOUNT_FIELD]: choice, ...rest } = data;
    const acc = accountRef.current;
    const loaded = acc?.status === 'ready' ? acc.account : null;
    choiceRef.current = loaded && choice ? choice : null;
    // Only accounts that are internal both now and after this save may write openBalena mappings.
    const mappingType = loaded?.type === 'internal' && choice?.type === 'internal' ? 'internal' : null;
    return modifyUser(guardMappings(mappingType, rest));
  };

  const onSuccess = async () => {
    const acc = accountRef.current;
    const choice = choiceRef.current;
    if (acc?.account && acc.userId != null && choice && choiceChanged(acc.account, choice)) {
      const r = await putAccount(acc.userId, choice);
      if (!r.ok) {
        notify(`User saved, but account type was not: ${apiMessage(r.body, 'unknown error')}`, { type: 'error' });
        acc.reload();
        return;
      }
      await Promise.all(
        ['organization membership', 'user-has-role', 'user-has-permission'].map((k) =>
          queryClient.invalidateQueries({ queryKey: [k] }),
        ),
      );
      acc.reload();
    }
    notify('ra.notification.updated', { type: 'info', messageArgs: { smart_count: 1 } });
    redirect('list', 'user');
  };

  return (
    <Edit
      title='Edit User'
      mutationMode='pessimistic'
      transform={transform}
      mutationOptions={{ onSuccess }}
      {...props}
      sx={{
        '> div > div': {
          maxWidth: '900px !important',
        },
      }}
    >
      <SimpleForm toolbar={<CustomToolbar />}>
        <AccountScope accountRef={accountRef}>
          <Row>
            <TextInput name='email' source='email' size='large' type='email' validate={[required(), email()]} />
            <TextInput name='username' source='username' size='large' validate={required()} readOnly={true} />
          </Row>
          <TextInput disabled name='jwt secret' source='jwt secret' size='large' fullWidth={true} />
          <ChangePasswordButton />
          <UserAccountType />

          <AdvancedSection />
        </AccountScope>
      </SimpleForm>
    </Edit>
  );
};

const userExport = {
  list: UserList,
  create: UserCreate,
  edit: UserEdit,
};

export default userExport;
