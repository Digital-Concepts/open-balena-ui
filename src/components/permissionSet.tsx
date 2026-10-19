import * as React from 'react';
import {
  BooleanField,
  CheckboxGroupInput,
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FunctionField,
  List,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
  useRecordContext,
} from 'react-admin';
import { Alert, Chip } from '@mui/material';
import { CAPABILITY_CHOICES } from '../lib/capabilities';

export const PermissionSetList: React.FC = () => (
  <List pagination={false}>
    <Datagrid size='medium' rowClick={false} bulkActionButtons={false}>
      <TextField source='name' />
      <TextField source='description' />
      <FunctionField
        label='Capabilities'
        render={(r: { capabilities?: string[] }) => (
          <>
            {(r.capabilities ?? []).map((c) => (
              <Chip key={c} label={c} size='small' sx={{ mr: 0.5, mb: 0.5 }} />
            ))}
          </>
        )}
      />
      <BooleanField source='builtin' label='Built-in' />
      <Toolbar>
        <EditButton label='' size='small' variant='outlined' />
        <DeleteButton mutationMode='pessimistic' label='' size='small' variant='outlined' />
      </Toolbar>
    </Datagrid>
  </List>
);

const PermissionSetForm: React.FC = () => {
  const record = useRecordContext<{ builtin?: boolean }>();
  return (
    <>
      {record?.builtin && <Alert severity='info'>Built-in permission sets cannot be changed.</Alert>}
      <TextInput source='name' validate={required()} fullWidth readOnly={record?.builtin} />
      <TextInput source='description' fullWidth multiline readOnly={record?.builtin} />
      <CheckboxGroupInput source='capabilities' choices={CAPABILITY_CHOICES} row={false} validate={required()} disabled={record?.builtin} />
    </>
  );
};

export const PermissionSetCreate: React.FC = () => (
  <Create title='Create Permission Set' redirect='list'>
    <SimpleForm>
      <PermissionSetForm />
    </SimpleForm>
  </Create>
);

export const PermissionSetEdit: React.FC = () => (
  <Edit title='Edit Permission Set' mutationMode='pessimistic' redirect='list'>
    <SimpleForm>
      <PermissionSetForm />
    </SimpleForm>
  </Edit>
);

const permissionSet = { list: PermissionSetList, create: PermissionSetCreate, edit: PermissionSetEdit };
export default permissionSet;
