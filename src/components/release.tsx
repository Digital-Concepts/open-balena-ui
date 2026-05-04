import * as React from 'react';
import {
  BooleanField,
  ChipField,
  Datagrid,
  FunctionField,
  List,
  ReferenceField,
  ReferenceManyCount,
  ReferenceManyField,
  SearchInput,
  SingleFieldList,
  TextField,
  Toolbar,
  useDataProvider,
  useListContext,
} from 'react-admin';
import type { FunctionFieldProps, RaRecord } from 'react-admin';
import DeleteReleaseButton from '../ui/DeleteReleaseButton';
import SemVerTextField from '../ui/SemVerTextField';

const releaseFilters = [<SearchInput source='status@ilike' alwaysOn />];

type BooleanBinaryFieldProps = Omit<FunctionFieldProps<RaRecord>, 'render'>;

const BooleanBinaryField: React.FC<BooleanBinaryFieldProps> = ({ source = 'enabled', ...props }) => (
  <FunctionField
    {...props}
    source={source}
    render={(record: RaRecord) => {
      const rawValue = record[source];
      const enabled = rawValue === 1 || rawValue === true;

      return <BooleanField source='enabled' record={{ ...record, enabled }} />;
    }}
  />
);

const TagChipField: React.FC = (props) => {
  return (
    <FunctionField
      {...props}
      render={(record) => (
        <ChipField source='tag' record={{ ...record, tag: `${record['tag key']}: ${record['value']}` }} />
      )}
    />
  );
};

const BulkDeleteButton: React.FC = (props) => {
  const { selectedIds } = useListContext();
  return (
    <DeleteReleaseButton
      selectedIds={selectedIds}
      context={useDataProvider()}
      size='small'
      {...props}
    >
      Delete Selected
    </DeleteReleaseButton>
  );
};

export const ReleaseList: React.FC = () => {
  return (
    <List filters={releaseFilters}>
      <Datagrid
        size='medium'
        rowClick={false}
        bulkActionButtons={<BulkDeleteButton />}
      >
        <ReferenceField
          label='Fleet'
          source='belongs to-application'
          reference='application'
          target='id'
          sortable={false}
        >
          <TextField source='app name' />
        </ReferenceField>
        <ReferenceField
          label='Host'
          source='belongs to-application'
          reference='application'
          target='id'
          sortable={false}
          link={false}
        >
          <BooleanBinaryField source='is host' />
        </ReferenceField>
        <SemVerTextField label='Version' />
        <ReferenceManyCount
          label='Devices'
          source='id'
          reference='device'
          target='is running-release'
          link={false}
          sortable={true}
        />
        <ReferenceManyCount
        label="Image Installs"
        source="id"
        reference="image install"
        target="is provided by-release"
        link={false}
        sortable={false}
      />
        <TextField label='Status' source='status' />

        <ReferenceManyField label='Tags' source='id' reference='release tag' target='release'>
          <SingleFieldList linkType={false}>
            <TagChipField />
          </SingleFieldList>
        </ReferenceManyField>

        <Toolbar>
          <DeleteReleaseButton variant='outlined' size='small' context={useDataProvider()} />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

const release = {
  list: ReleaseList,
};

export default release;
