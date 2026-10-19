import React from 'react';
import { Box } from '@mui/material';
import { Identifier, Loading, RaRecord, useGetList, useRecordContext } from 'react-admin';
import { useFormContext } from 'react-hook-form';
import GenericTransferList, { TransferListOption } from '../components/genericTransferList';
import { useFreshSince } from '../lib/useFreshSince';

interface RoleRecord extends RaRecord {
  name: string;
}

interface RoleAssignmentRecord extends RaRecord {
  role: Identifier;
}

interface ManageRolesProps {
  source: string;
  reference: string;
  target: string;
}

export const ManageRoles: React.FC<ManageRolesProps> = ({ source, reference, target }) => {
  const record = useRecordContext<RaRecord>();
  const { setValue } = useFormContext();
  const [selection, setSelection] = React.useState<Identifier[]>([]);

  const { data: roleRecords = [], isLoading: rolesLoading } = useGetList<RoleRecord>('role', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  const {
    data: assignmentRecords = [],
    isLoading: assignmentsLoading,
    isError: assignmentsError,
    dataUpdatedAt: assignmentsUpdatedAt,
  } = useGetList<RoleAssignmentRecord>(
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

  const assignmentsFresh = useFreshSince(record?.id, assignmentsUpdatedAt, assignmentsLoading);
  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    initializedRef.current = false;
    setSelection([]);
  }, [record?.id]);

  const selectedIds = React.useMemo<Identifier[]>(
    () => assignmentRecords.map((assignment) => assignment.role).filter((id): id is Identifier => id != null),
    [assignmentRecords],
  );

  React.useEffect(() => {
    if (!initializedRef.current && !rolesLoading && assignmentsFresh) {
      setSelection(selectedIds);
      setValue(source, selectedIds, { shouldDirty: false });
      initializedRef.current = true;
    }
  }, [assignmentsFresh, rolesLoading, selectedIds, setValue, source]);

  const roleOptions = React.useMemo<TransferListOption[]>(
    () => roleRecords.map((role) => ({ id: role.id, label: role.name })),
    [roleRecords],
  );

  const handleSelectionChange = React.useCallback(
    (nextIds: Identifier[]) => {
      setSelection(nextIds);
      setValue(source, nextIds, { shouldDirty: true });
    },
    [setValue, source],
  );

  if (assignmentsError || !record?.id) {
    return <Box sx={{ my: 2 }}>Could not load roles; editing is disabled to avoid data loss.</Box>;
  }

  if (rolesLoading || assignmentsLoading || !assignmentsFresh) {
    return <Loading />;
  }

  return (
    <Box sx={{ width: 800, maxWidth: '100%' }}>
      <strong style={{ margin: '40px 0 10px', display: 'block' }}>Roles</strong>

      <GenericTransferList
        options={roleOptions}
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

export default ManageRoles;
