import * as React from 'react';
import {
  Confirm,
  Create,
  Datagrid,
  DeleteWithConfirmButton,
  Edit,
  EditButton,
  FormDataConsumer,
  FunctionField,
  List,
  ReferenceField,
  ReferenceInput,
  SaveButton,
  SelectInput,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
  required,
  useSaveContext,
  useUnique,
} from 'react-admin';
import { useFormContext } from 'react-hook-form';
import CopyChip from '../ui/CopyChip';
import JsonValueInput from '../ui/JsonValueInput';
import VarNameInput from '../ui/VarNameInput';

const SaveWithConfirmToolbar: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  const [pendingValues, setPendingValues] = React.useState<any>(null);
  const form = useFormContext();
  const { save } = useSaveContext();

  const handleClick = form.handleSubmit((data) => {
    setPendingValues(data);
    setOpen(true);
  });

  const handleConfirm = () => {
    setOpen(false);
    if (save && pendingValues) save(pendingValues);
  };

  return (
    <Toolbar>
      <div className='RaToolbar-defaultToolbar'>
        <SaveButton type='button' onClick={handleClick} />
        <DeleteWithConfirmButton
          mutationMode='pessimistic'
          confirmTitle='Delete Fleet Config Var'
          confirmContent={
            <>
              Are you sure you want to delete this config variable? <p />{' '}
              <strong style={{ color: 'red' }}>
                This action will cause all gateways in the fleet to reboot.
              </strong>
            </>
          }
        />
      </div>
      <Confirm
        isOpen={open}
        loading={form.formState.isSubmitting}
        title='Save Fleet Config Var'
        content={
          <>
            Are you sure you want to save these changes? <p />{' '}
            <strong style={{ color: 'red' }}>
              This action will cause all gateways in the fleet to reboot.
            </strong>
          </>
        }
        onConfirm={handleConfirm}
        onClose={() => setOpen(false)}
      />
    </Toolbar>
  );
};

const uniqueIssueMessage = 'This ConfigVar is already present for this Fleet';

export const FleetConfigVarList: React.FC = () => {
  return (
    <List title='Fleet Config Vars'>
      <Datagrid size='medium' rowClick={false}>
        <ReferenceField label='Fleet' source='application' reference='application' target='id'>
          <TextField source='app name' />
        </ReferenceField>

        <TextField label='Name' source='name' />

        <FunctionField
          label='Value'
          render={(record) => (
            <CopyChip
              title={record.value}
              label={record.value.slice(0, 40) + (record.value.length > 40 ? '...' : '')}
            />
          )}
        />

        <Toolbar>
          <EditButton label='' size='small' variant='outlined' />
          <DeleteWithConfirmButton 
              mutationMode='pessimistic' 
              label='' 
              size='small' 
              variant='outlined' 
              confirmTitle='Delete Fleet Config Var'
              confirmContent={
                <>
                  Are you sure you want to delete this config variable? <p />{' '}
                  <strong style={{ color: 'red' }}>
                    This action will cause all gateways in the fleet to reboot.
                  </strong>
                </>
              }
          />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const FleetConfigVarCreate: React.FC = () => {
  const unique = useUnique();
  return (
    <Create title='Create Fleet Config Var' redirect='list'>
      <SimpleForm>
        <ReferenceInput
          source='application'
          reference='application'
          target='id'
          perPage={1000}
          sort={{ field: 'app name', order: 'ASC' }}
        >
          <SelectInput
            label='Fleet name'
            optionText='app name'
            optionValue='id'
            validate={required()}
            fullWidth={true}
          />
        </ReferenceInput>

        <FormDataConsumer>
          {({ formData }) => (
            <VarNameInput
              resource='application config variable'
              validate={[
                required(),
                unique({
                  filter: {
                    application: formData.application,
                  },
                  message: uniqueIssueMessage,
                }),
              ]}
            />
          )}
        </FormDataConsumer>
        <JsonValueInput label='Value' source='value' validate={required()} />
      </SimpleForm>
    </Create>
  );
};

export const FleetConfigVarEdit: React.FC = () => (
  <Edit title='Edit Fleet Config Var' mutationMode='pessimistic'>
    <SimpleForm toolbar={<SaveWithConfirmToolbar />}>
      <ReferenceInput
        source='application'
        reference='application'
        target='id'
        perPage={1000}
        sort={{ field: 'app name', order: 'ASC' }}
      >
        <SelectInput label='Fleet name' optionText='app name' optionValue='id' validate={required()} fullWidth={true} />
      </ReferenceInput>

      <VarNameInput resource='application config variable' validate={required()} />
      <JsonValueInput label='Value' source='value' validate={required()} />
    </SimpleForm>
  </Edit>
);

const fleetConfigVar = {
  list: FleetConfigVarList,
  create: FleetConfigVarCreate,
  edit: FleetConfigVarEdit,
};

export default fleetConfigVar;
