import * as React from 'react';
import {
  BulkDeleteButton,
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  EditProps,
  List,
  ReferenceManyField,
  SimpleForm,
  SingleFieldList,
  TextField,
  TextInput,
  Toolbar,
  required,
} from 'react-admin';
import { OrganizationFleetsForm } from '../ui/ManageOrganizationFleets';
import OrgCustomerSettings, { OrgSettingsProvider } from '../ui/OrgCustomerSettings';

export const OrganizationList: React.FC = () => {
  return (
    <List>
      <Datagrid
        size='medium'
        rowClick={false}
        bulkActionButtons={<BulkDeleteButton mutationMode='pessimistic' />}
      >
        <TextField source='name' />
        <TextField source='handle' />

        <ReferenceManyField label='Fleets' source='id' reference='application' target='organization'>
          <SingleFieldList linkType={false}>
            <TextField source='app name' />
          </SingleFieldList>
        </ReferenceManyField>

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteButton mutationMode='pessimistic' label='' size='small' variant='outlined' />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const OrganizationCreate: React.FC = () => (
  <Create title='Create Org'>
    <SimpleForm>
      <TextInput source='name' validate={required()} size='large' fullWidth={true} />
      <TextInput source='handle' validate={required()} size='large' fullWidth={true} />
    </SimpleForm>
  </Create>
);

export const OrganizationEdit: React.FC<EditProps> = (props) => (
  <Edit title='Edit Org' mutationMode='pessimistic' {...props}>
    <OrgSettingsProvider>
      <OrganizationFleetsForm>
        <TextInput source='name' validate={required()} size='large' fullWidth={true} />
        <TextInput source='handle' validate={required()} size='large' fullWidth={true} />
        <OrgCustomerSettings />
      </OrganizationFleetsForm>
    </OrgSettingsProvider>
  </Edit>
);

const organization = {
  list: OrganizationList,
  create: OrganizationCreate,
  edit: OrganizationEdit,
};

export default organization;
