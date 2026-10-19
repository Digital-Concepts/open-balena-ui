import React from 'react';
import { Box } from '@mui/material';
import { Identifier, Loading, RaRecord, useGetList, useRecordContext } from 'react-admin';
import { useFormContext } from 'react-hook-form';
import GenericTransferList, { TransferListOption } from '../components/genericTransferList';
import { useFreshSince } from '../lib/useFreshSince';

interface OrganizationRecord extends RaRecord {
  name: string;
}

interface OrganizationMembershipRecord extends RaRecord {
  'is member of-organization': Identifier;
}

interface ManageOrganizationsProps {
  source: string;
  reference: string;
  target: string;
}

export const ManageOrganizations: React.FC<ManageOrganizationsProps> = ({ source, reference, target }) => {
  const record = useRecordContext<RaRecord>();
  const { setValue } = useFormContext();
  const [selection, setSelection] = React.useState<Identifier[]>([]);

  const { data: organizationRecords = [], isLoading: organizationsLoading } = useGetList<OrganizationRecord>(
    'organization',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    },
  );

  const {
    data: membershipRecords = [],
    isLoading: membershipsLoading,
    isError: membershipsError,
    dataUpdatedAt: membershipsUpdatedAt,
  } = useGetList<OrganizationMembershipRecord>(
    reference,
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: record?.id ? { [target]: record.id } : {},
    },
    {
      enabled: Boolean(record?.id),
      refetchOnMount: 'always',
    },
  );

  const membershipsFresh = useFreshSince(record?.id, membershipsUpdatedAt, membershipsLoading);
  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    initializedRef.current = false;
    setSelection([]);
  }, [record?.id]);

  const selectedIds = React.useMemo<Identifier[]>(
    () =>
      membershipRecords
        .map((membership) => membership['is member of-organization'])
        .filter((id): id is Identifier => id != null),
    [membershipRecords],
  );

  React.useEffect(() => {
    if (!initializedRef.current && !organizationsLoading && membershipsFresh) {
      setSelection(selectedIds);
      setValue(source, selectedIds, { shouldDirty: false });
      initializedRef.current = true;
    }
  }, [membershipsFresh, organizationsLoading, selectedIds, setValue, source]);

  const organizationOptions = React.useMemo<TransferListOption[]>(
    () => organizationRecords.map((organization) => ({ id: organization.id, label: organization.name })),
    [organizationRecords],
  );

  const handleSelectionChange = React.useCallback(
    (nextIds: Identifier[]) => {
      setSelection(nextIds);
      setValue(source, nextIds, { shouldDirty: true });
    },
    [setValue, source],
  );

  if (membershipsError || !record?.id) {
    return <Box sx={{ my: 2 }}>Could not load organizations; editing is disabled to avoid data loss.</Box>;
  }

  if (organizationsLoading || membershipsLoading || !membershipsFresh) {
    return <Loading />;
  }

  return (
    <Box sx={{ width: 800, maxWidth: '100%' }}>
      <strong style={{ margin: '40px 0 10px', display: 'block' }}>Organizations</strong>

      <GenericTransferList
        options={organizationOptions}
        value={selection}
        onChange={handleSelectionChange}
        availableLabel='Available'
        selectedLabel='Selected'
        listWidth={320}
        listHeight={360}
      />
    </Box>
  );
};

export default ManageOrganizations;
