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
  SingleFieldList,
  TextField,
  Toolbar,
  useDataProvider,
  useGetList,
  useListContext,
} from 'react-admin';
import type { FunctionFieldProps, RaRecord } from 'react-admin';
import { Box, TextField as MuiTextField } from '@mui/material';
import DeleteReleaseButton from '../ui/DeleteReleaseButton';
import SemVerTextField from '../ui/SemVerTextField';
import { getSemver } from '../ui/SemVerChip';

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

const ReleaseSearchBar: React.FC<{
  value: string;
  onChange: (next: string) => void;
}> = ({ value, onChange }) => {
  return (
    <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
      <MuiTextField
        size='small'
        placeholder='Search by commit, status, fleet or tag…'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        sx={{ minWidth: 360 }}
      />
    </Box>
  );
};

const useDebounced = <T,>(value: T, ms: number): T => {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

const useReleaseSearchFilter = (term: string): Record<string, any> => {
  const debounced = useDebounced(term, 250);

  const { data: releases } = useGetList('release', {
    pagination: { page: 1, perPage: 10000 },
    sort: { field: 'id', order: 'ASC' },
  });
  const { data: fleets } = useGetList('application', {
    filter: { 'is of-class': 'fleet' },
    pagination: { page: 1, perPage: 10000 },
    sort: { field: 'id', order: 'ASC' },
  });
  const { data: tags } = useGetList('release tag', {
    pagination: { page: 1, perPage: 10000 },
    sort: { field: 'id', order: 'ASC' },
  });

  return React.useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return {};

    const fleetIdsMatching = new Set<string>();
    (fleets ?? []).forEach((f: any) => {
      const name = (f?.['app name'] ?? '').toString().toLowerCase();
      if (name.includes(q)) fleetIdsMatching.add(String(f.id));
    });

    const releaseIdsFromTags = new Set<string>();
    (tags ?? []).forEach((t: any) => {
      const key = (t?.['tag key'] ?? '').toString().toLowerCase();
      const val = (t?.value ?? '').toString().toLowerCase();
      if (key.includes(q) || val.includes(q)) {
        if (t?.release != null) releaseIdsFromTags.add(String(t.release));
      }
    });

    const matchingIds = new Set<string>();
    (releases ?? []).forEach((r: any) => {
      const commit = (r?.commit ?? '').toString().toLowerCase();
      const status = (r?.status ?? '').toString().toLowerCase();
      const version = getSemver(r).toLowerCase();
      const fleetId = r?.['belongs to-application'];
      if (
        commit.includes(q) ||
        status.includes(q) ||
        version.includes(q) ||
        (fleetId != null && fleetIdsMatching.has(String(fleetId))) ||
        releaseIdsFromTags.has(String(r.id))
      ) {
        matchingIds.add(String(r.id));
      }
    });

    const list = Array.from(matchingIds);
    return { 'id@in': list.length > 0 ? `(${list.join(',')})` : '(-1)' };
  }, [debounced, releases, fleets, tags]);
};

export const ReleaseList: React.FC = () => {
  const [searchTerm, setSearchTerm] = React.useState('');
  const filter = useReleaseSearchFilter(searchTerm);

  return (
    <div>
      <ReleaseSearchBar value={searchTerm} onChange={setSearchTerm} />
      <List filter={filter}>
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
    </div>
  );
};

const release = {
  list: ReleaseList,
};

export default release;
