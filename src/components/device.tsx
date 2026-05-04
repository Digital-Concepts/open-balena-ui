import {
	Icon,
	Tooltip,
	useTheme,
	Accordion,
	AccordionSummary,
	AccordionDetails,
	Typography,
	Badge,
	Box,
	Button,
	FormControl,
	InputLabel,
	Select,
	MenuItem,
	Checkbox,
	FormControlLabel,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import {
	Done,
	Warning,
	WarningAmber,
	PushPin,
	ExpandMore,
	ViewList,
	ViewModule,
} from '@mui/icons-material';
import dateFormat from 'dateformat';
import * as React from 'react';
import {
	Create,
	CreateButton,
	Datagrid,
	Edit,
	EditButton,
	ExportButton,
	FilterButton,
	FormDataConsumer,
	FunctionField,
	List,
	Pagination,
	ReferenceField,
	ReferenceInput,
	SearchInput,
	SelectInput,
	ShowButton,
	SimpleForm,
	TextField,
	TextInput,
	Toolbar,
	TopToolbar,
	required,
	useGetOne,
	useRedirect,
	useListContext,
	WithRecord,
	useGetList,
	RecordContextProvider,
	FunctionFieldProps,
	PaginationProps,
	ListProps,
} from 'react-admin';
import { v4 as uuidv4 } from 'uuid';
import {
	useCreateDevice,
	useModifyDevice,
	useSetServicesForNewDevice,
} from '../lib/device';
import CopyChip from '../ui/CopyChip';
import DeleteDeviceButton, { DeleteDeviceButtonProps } from '../ui/DeleteDeviceButton';
import DeviceConnectButton from '../ui/DeviceConnectButton';
import DeviceServicesButton from '../ui/DeviceServicesButton';
import Row from '../ui/Row';
import SelectOperatingSystem from '../ui/SelectOperatingSystem';
import SemVerChip, { getSemver } from '../ui/SemVerChip';
import versions from '../versions';
import environment from '../lib/reactAppEnv';
import UseAnimations from 'react-useanimations';
import arrowDown from 'react-useanimations/lib/arrowDown';
import { resolveDeviceTargetRelease } from '../lib/targetRelease';
import TargetReleaseIcon from '../ui/TargetReleaseIcon';
import TargetReleaseTooltip from '../ui/TargetReleaseTooltip';
import DeviceStructuredFilter from '../ui/DeviceStructuredFilter';

// Get the proper field name for isPinnedOnRelease based on API version
const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);

export const OnlineField: React.FC<Omit<FunctionFieldProps<any>, 'render'>> = (props) => {
  const theme = useTheme();

  return (
    <FunctionField
      {...props}
      render={(record, source) => {
        if (!source) {
          return null;
        }
        const isOnline = record[source] === 'online';

        return (
          <Tooltip placement='top' arrow={true} title={'Since ' + dateFormat(new Date(record['last connectivity event']))} >
            <strong style={{ color: isOnline ? theme.palette.success.light : theme.palette.error.light }}>
              {isOnline ? 'Online' : 'Offline'}
            </strong>
          </Tooltip>
        );
      }}
    />
  );
};

export const ReleaseField: React.FC<Omit<FunctionFieldProps<any>, 'render'>> = (props) => {
  const theme = useTheme();

  return (
    <FunctionField
      {...props}
      render={(record, source) => <ReleaseFieldContent record={record} source={source} theme={theme} />}
    />
  );
};

const deviceFilters = [<SearchInput source='#device name,note,ip address,status@ilike' alwaysOn />];

const ReleaseFieldContent: React.FC<{
  record: Record<string, any> | null;
  source?: string;
  theme: Theme;
}> = ({ record, source, theme }) => {
  if (!record || !source) {
    return null;
  }

  const applicationId = record['belongs to-application'];
  const shouldFetchFleet = Boolean(applicationId);
  const {
    data: fleet,
    isPending,
    error,
  } = useGetOne('application', { id: applicationId }, { enabled: shouldFetchFleet });

  if (shouldFetchFleet && isPending) {
    return <p>Loading</p>;
  }

  if (shouldFetchFleet && error) {
    return <p>ERROR</p>;
  }

  const { targetReleaseId, origin } = resolveDeviceTargetRelease({
    record,
    fleetRecord: fleet,
    pinField: isPinnedOnRelease,
  });

  const augmentedRecord =
    targetReleaseId !== undefined && targetReleaseId !== record['should be running-release']
      ? { ...record, ['should be running-release']: targetReleaseId }
      : record;

  const isTrackingLatest = origin === 'latest';
  const currentRelease = record[source];
  const hasTarget = targetReleaseId !== undefined && targetReleaseId !== null;
  const isTargetMatch =
    hasTarget && currentRelease !== undefined && currentRelease !== null
      ? String(currentRelease) === String(targetReleaseId)
      : false;

  const isUpToDate = hasTarget ? isTargetMatch : isTrackingLatest;
  const isOnline = record['api heartbeat state'] === 'online';
  const chipIcon = isUpToDate && hasTarget ? <TargetReleaseIcon origin={origin} fontSize='small' /> : undefined;

  return (
    <RecordContextProvider value={augmentedRecord}>
      <ReferenceField label='Current Release' source='is running-release' reference='release' target='id'>
        <SemVerChip icon={chipIcon} sx={{ position: 'relative', top: '-5px' }} withTooltip={false} />
      </ReferenceField>

      {record[source] &&
        (targetReleaseId !== undefined && targetReleaseId !== null ? (
          <ReferenceField reference='release' target='id' source='should be running-release' link={false}>
            <TargetReleaseTooltip origin={origin}>
              <span
                style={{
                  position: 'relative',
                  top: '3px',
                  left: '3px',
                  color: !isUpToDate && isOnline ? theme.palette.error.light : theme.palette.text.primary,
                }}
              >
                {isUpToDate ? <Done /> : isOnline ? <UseAnimations animation={arrowDown} size={24} /> : <WarningAmber />}
              </span>
            </TargetReleaseTooltip>
          </ReferenceField>
        ) : (
          <TargetReleaseTooltip origin={origin} fallbackDetail='Tracking latest release'>
            <span
              style={{
                position: 'relative',
                top: '3px',
                left: '3px',
                color: !isUpToDate && isOnline ? theme.palette.error.light : theme.palette.text.primary,
              }}
            >
              {isUpToDate ? <Done /> : isOnline ? <Warning /> : <WarningAmber />}
            </span>
          </TargetReleaseTooltip>
        ))}
    </RecordContextProvider>
  );
};

const CustomBulkActionButtons: React.FC<DeleteDeviceButtonProps> = (props) => {
  const { selectedIds } = useListContext();

  return (
    <React.Fragment>
      <DeleteDeviceButton size='small' selectedIds={selectedIds} {...props}>
        Delete Selected Devices
      </DeleteDeviceButton>
    </React.Fragment>
  );
};

const ExtendedPagination: React.FC<PaginationProps> = ({
	rowsPerPageOptions = [25, 50, 100, 250],
	...props
}) => <Pagination rowsPerPageOptions={rowsPerPageOptions} {...props} />;

const AgeSortController: React.FC<{ ageSort: string }> = ({ ageSort }) => {
	const { setSort } = useListContext();
	React.useEffect(() => {
		setSort({ field: 'id', order: (ageSort as 'ASC' | 'DESC') || 'ASC' });
	}, [ageSort]);
	return null;
};

export const DeviceList: React.FC<ListProps<any>> = (props) => {
	const [groupedView, setGroupedView] = React.useState(false);
	const [selectedFleet, setSelectedFleet] = React.useState<string>(() => {
		return localStorage.getItem('selectedFleet') || '';
	});
	const [ageSort, setAgeSort] = React.useState<string>(() => {
		return localStorage.getItem('ageSort') || '';
	});
	const [hideOffline, setHideOffline] = React.useState<boolean>(() => {
		return localStorage.getItem('hideOffline') === 'true';
	});
	const { title, ...listProps } = props;

	const { data: fleets } = useGetList('application', {
		filter: { 'is of-class': 'fleet' },
		sort: { field: 'app name', order: 'ASC' },
		pagination: { page: 1, perPage: 1000 },
	});

	const deviceFilter: Record<string, any> = {
		...(selectedFleet && { 'belongs to-application': selectedFleet }),
		...(hideOffline && { 'api heartbeat state': 'online' }),
	};

	const handleFleetChange = (event: any) => {
		const fleetId = event.target.value as string;
		setSelectedFleet(fleetId);
		if (fleetId) {
			localStorage.setItem('selectedFleet', fleetId);
		} else {
			localStorage.removeItem('selectedFleet');
		}
	};

	const handleAgeSortChange = (event: any) => {
		const value = event.target.value as string;
		setAgeSort(value);
		if (value) {
			localStorage.setItem('ageSort', value);
		} else {
			localStorage.removeItem('ageSort');
		}
	};

	const handleHideOfflineChange = () => {
		const newValue = !hideOffline;
		setHideOffline(newValue);
		localStorage.setItem('hideOffline', String(newValue));
	};

	const clearFleetFilter = () => {
		setSelectedFleet('');
		localStorage.removeItem('selectedFleet');
	};

	if (groupedView) {
		return (
			<div>
				<Button startIcon={<ViewList />} onClick={() => setGroupedView(false)} sx={{ mb: 2 }}>
					Switch to List View
				</Button>
				<FleetGroupedDeviceList />
			</div>
		);
	}

	return (
		<div>
			<Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
				<Button startIcon={<ViewModule />} onClick={() => setGroupedView(true)}>
					Group by Fleet
				</Button>
				<FormControl size='small' sx={{ minWidth: 200 }}>
					<Select
						labelId='fleet-select-label'
						id='fleet-select'
						value={selectedFleet}
						label='Filter by Fleet'
						onChange={handleFleetChange}
						displayEmpty
						sx={{
							backgroundColor: '#2A506F',
							color: 'white',
							'& .MuiOutlinedInput-notchedOutline': { borderColor: '#2A506F' },
							'& .MuiSelect-icon': { color: 'white' },
						}}
						MenuProps={{
							PaperProps: {
								sx: {
									backgroundColor: '#2A506F',
									'& .MuiMenuItem-root': {
										color: 'white',
										'&:hover': { backgroundColor: '#34607F' },
										'&.Mui-selected': { backgroundColor: '#34607F', '&:hover': { backgroundColor: '#3E708F' } },
									},
								},
							},
						}}
					>
						<MenuItem value=''>
							<b>All Fleets</b>
						</MenuItem>
						{fleets?.map((fleet: any) => (
							<MenuItem key={fleet.id} value={fleet.id}>
								{fleet['app name']}
							</MenuItem>
						))}
					</Select>
				</FormControl>

				{selectedFleet && (
					<Button variant='outlined' size='small' onClick={clearFleetFilter} sx={{ height: 'fit-content' }}>
						Clear Filter
					</Button>
				)}

				<FormControl size='small' sx={{ width: 190 }}>
					<Select
						value={ageSort}
						onChange={handleAgeSortChange}
						displayEmpty
						sx={{
							backgroundColor: '#2A506F',
							color: 'white',
							'& .MuiOutlinedInput-notchedOutline': { borderColor: '#2A506F' },
							'& .MuiSelect-icon': { color: 'white' },
						}}
						MenuProps={{
							PaperProps: {
								sx: {
									backgroundColor: '#2A506F',
									'& .MuiMenuItem-root': {
										color: 'white',
										'&:hover': { backgroundColor: '#34607F' },
										'&.Mui-selected': { backgroundColor: '#34607F', '&:hover': { backgroundColor: '#3E708F' } },
									},
								},
							},
						}}
					>
						<MenuItem value=''>
							<b>Sort by Age</b>
						</MenuItem>
						<MenuItem value='ASC'>Age: Oldest First</MenuItem>
						<MenuItem value='DESC'>Age: Newest First</MenuItem>
					</Select>
				</FormControl>

				<FormControlLabel
					control={
						<Checkbox
							checked={hideOffline}
							onChange={handleHideOfflineChange}
							sx={{
								color: '#2A506F',
								'&.Mui-checked': { color: '#2A506F' },
							}}
						/>
					}
					label='Hide Offline Devices'
					sx={{ color: '#2A506F' }}
				/>
			</Box>

			<List {...listProps} title={title} filters={deviceFilters} filter={deviceFilter} pagination={<ExtendedPagination />}>
				<AgeSortController ageSort={ageSort} />
				<Datagrid rowClick={false} bulkActionButtons={<CustomBulkActionButtons />} size='medium'>
					<ReferenceField label='Name' source='id' reference='device' target='id' link='show' sortBy='device name'>
						<TextField source='device name' />
					</ReferenceField>

					<OnlineField label='Status' source='api heartbeat state' />

					<FunctionField
						label='VPN Status'
						render={(record) => (
							<Tooltip placement='top' arrow={true} title={'Since ' + dateFormat(new Date(record['last vpn event']))}>
								<span>{record['is connected to vpn'] ? 'Connected' : 'Disconnected'}</span>
							</Tooltip>
						)}
					/>

					<FunctionField
						label='IP Address'
						render={(record) => {
							const ipAddress = record['ip address'] || '';
							const ipv4Regex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
							const ipv4Addresses = ipAddress.match(ipv4Regex) || [];
							const displayIp = ipv4Addresses.join(', ');
							const hrefIp = ipv4Addresses[0];
							return displayIp && hrefIp ? (
								<a
									href={`http://${hrefIp}`}
									target='_blank'
									rel='noopener noreferrer'
									style={{
										textDecoration: 'none',
										padding: '6px 14px',
										borderRadius: '8px',
										backgroundColor: 'rgba(25, 118, 210, 0.15)',
										color: '#1976d2',
										display: 'inline-block',
										fontSize: '0.875rem',
										fontWeight: 400,
										transition: 'all 0.2s ease',
										cursor: 'pointer',
										border: '1px solid rgba(25, 118, 210, 0.3)',
									}}
									onMouseEnter={(e) => {
										(e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(25, 118, 210, 0.25)';
										(e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(25, 118, 210, 0.5)';
									}}
									onMouseLeave={(e) => {
										(e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(25, 118, 210, 0.15)';
										(e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(25, 118, 210, 0.3)';
									}}
								>
									{displayIp}
								</a>
							) : (
								''
							);
						}}
					/>

					<ReleaseField label='Current Release' source='is running-release' />

					<FunctionField
						label='Notes'
						render={(record) => (
							<Box
								sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
								title={record.note || ''}
							>
								{record.note || ''}
							</Box>
						)}
					/>

					<ReferenceField label='Fleet' source='belongs to-application' reference='application' target='id'>
						<TextField source='app name' />
					</ReferenceField>

					<Toolbar sx={{ background: 'none', padding: '0' }}>
						<ShowButton variant='outlined' label='' size='small' />
						<EditButton variant='outlined' label='' size='small' />
						<WithRecord
							render={(device) => (
								<>
									<DeviceServicesButton variant='outlined' size='small' device={device} />
									<DeviceConnectButton variant='outlined' size='small' record={device} />
								</>
							)}
						/>
						<DeleteDeviceButton variant='outlined' size='small' style={{ marginRight: '0 !important' }} />
					</Toolbar>
				</Datagrid>
			</List>
		</div>
	);
};

const FleetDeviceList: React.FC<{ fleetId: string | number; fleetName?: string }> = ({ fleetId }) => {
	return (
		<List
			resource='device'
			filter={{ 'belongs to-application': fleetId }}
			pagination={<ExtendedPagination />}
			actions={false}
		>
			<Datagrid rowClick={false} bulkActionButtons={<CustomBulkActionButtons />} size='medium'>
				<ReferenceField label='Name' source='id' reference='device' target='id' link='show' sortBy='device name'>
					<TextField source='device name' />
				</ReferenceField>

        <OnlineField label='Status' source='api heartbeat state' />

        <FunctionField
          label='VPN Status'
          render={(record) => (
            <Tooltip
              placement='top'
              arrow={true}
              title={'Since ' + dateFormat(new Date(record['last vpn event']))}
              >
              <span>{record['is connected to vpn'] ? 'Connected' : 'Disconnected'}</span>
            </Tooltip>
            )}
        />

		<FunctionField 
			label="IP Address" 
			render={(record) => {
				const ipAddress = record['ip address'] || '';
				// only ipv4 addresses
				const ipv4Regex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
				const ipv4Addresses = ipAddress.match(ipv4Regex) || [];
				const ip = ipv4Addresses.join(', ')
				return ip ? (
				<a
					href={`http://${ip}`}
					target="_blank"
					rel="noopener noreferrer"
					style={{ textDecoration: 'none' }}
					>{ip}</a>
				) : (
					''
				);
			}} 
		/>

        <ReleaseField label='Current Release' source='is running-release' />

		<FunctionField label="Notes" render={(record) => record.note || ''} />

        <Toolbar sx={{ background: 'none', padding: '0' }}>
          <ShowButton variant='outlined' label='' size='small' />
          <EditButton variant='outlined' label='' size='small' />
          <WithRecord
            render={(device) => (
              <>
                <DeviceServicesButton variant='outlined' size='small' device={device} />
                <DeviceConnectButton variant='outlined' size='small' record={device} />
              </>
            )}
          />
          <DeleteDeviceButton variant='outlined' size='small' style={{ marginRight: '0 !important' }} />
        </Toolbar>
      </Datagrid>
    </List>
  );
};

export const FleetGroupedDeviceList: React.FC = () => {
	const { data: fleets, isLoading: fleetsLoading } = useGetList('application', {
		filter: { 'is of-class': 'fleet' },
		sort: { field: 'app name', order: 'ASC' },
		pagination: { page: 1, perPage: 1000 },
	});

	const { data: devices, isLoading: devicesLoading } = useGetList('device', {
		sort: { field: 'device name', order: 'ASC' },
		pagination: { page: 1, perPage: 1000 },
	});

	if (fleetsLoading || devicesLoading) {
		return <div>Loading...</div>;
	}

	const devicesByFleet: Record<string, any[]> =
		devices?.reduce((acc: Record<string, any[]>, device: any) => {
			const fleetId = device['belongs to-application'];
			if (!acc[fleetId]) {
				acc[fleetId] = [];
			}
			acc[fleetId].push(device);
			return acc;
		}, {}) || {};

	return (
		<div>
			<Box sx={{ width: '100%' }}>
				{fleets?.map((fleet: any) => {
					const fleetDevices = devicesByFleet[fleet.id] || [];
					return (
						<Accordion key={fleet.id} sx={{ mb: 1 }}>
							<AccordionSummary
								expandIcon={<ExpandMore />}
								aria-controls={`fleet-${fleet.id}-content`}
								id={`fleet-${fleet.id}-header`}
							>
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
									<Typography variant='h6'>{fleet['app name']}</Typography>
									<Badge badgeContent={fleetDevices.length} color='primary' />
								</Box>
							</AccordionSummary>
							<AccordionDetails>
								<FleetDeviceList fleetId={fleet.id} fleetName={fleet['app name']} />
							</AccordionDetails>
						</Accordion>
					);
				})}
			</Box>
		</div>
	);
};

export const DeviceCreate: React.FC = () => {
  const createDevice = useCreateDevice();
  const setServicesForNewDevice = useSetServicesForNewDevice();
  const redirect = useRedirect();

  const onSuccess = async (data) => {
    await setServicesForNewDevice(data);
    redirect('list', 'device', data.id);
  };

  return (
    <Create title='Create Device' transform={createDevice} mutationOptions={{ onSuccess }}>
      <SimpleForm>
        <Row>
          <TextInput label='UUID' source='uuid' defaultValue={uuidv4().replace(/-/g, '').toLowerCase()} validate={required()} size='large' readOnly={true} />

          <TextInput label='Device Name' source='device name' validate={required()} size='large' />
        </Row>

        <TextInput label='Note' source='note' size='large' fullWidth={true} />

        <Row>
          <ReferenceInput
            label='Device Type'
            source='is of-device type'
            reference='device type'
            target='id'
            perPage={1000}
            sort={{ field: 'slug', order: 'ASC' }}
          >
            <SelectInput optionText='slug' optionValue='id' validate={required()} size='large' />
          </ReferenceInput>

          <ReferenceInput label='Managed by Device' source='is managed by-device' reference='device' target='id' allowEmpty >
            <SelectInput optionText='device name' optionValue='id' size='large' />
          </ReferenceInput>
        </Row>

        <Row>
          <ReferenceInput
            label='Fleet'
            source='belongs to-application'
            reference='application'
            target='id'
            perPage={1000}
            sort={{ field: 'app name', order: 'ASC' }}
            filter={{ 'is of-class': 'fleet' }}
          >
            <SelectInput optionText='app name' optionValue='id' validate={required()} size='large' />
          </ReferenceInput>

          <FormDataConsumer>
            {({ formData, ...rest }) =>
              formData['belongs to-application'] && (
                <ReferenceInput
                  label='Target Release'
                  source={isPinnedOnRelease}
                  reference='release'
                  target='id'
                  filter={{ 'belongs to-application': formData['belongs to-application'] }}
                  allowEmpty
                >
                  <SelectInput optionText={(o) => getSemver(o)} optionValue='id' />
                </ReferenceInput>
              )
            }
          </FormDataConsumer>
        </Row>

        <SelectOperatingSystem label='Target OS' source='should be operated by-release' />
      </SimpleForm>
    </Create>
  );
};

export const DeviceEdit: React.FC = () => {
  const modifyDevice = useModifyDevice();

  return (
    <Edit title='Edit Device' actions={false} transform={modifyDevice}>
      <SimpleForm>
        <Row>
          <TextInput label='UUID' source='uuid' size='large' readOnly={true} />

          <TextInput label='Device Name' source='device name' size='large' />
        </Row>

        <TextInput label='Note' source='note' size='large' fullWidth={true} />

        <Row>
          <ReferenceInput
            label='Device Type'
            source='is of-device type'
            reference='device type'
            target='id'
            perPage={1000}
            sort={{ field: 'slug', order: 'ASC' }}
          >
            <SelectInput optionText='slug' optionValue='id' validate={required()} />
          </ReferenceInput>

          <ReferenceInput
            label='Managed by Device'
            source='is managed by-device'
            reference='device'
            target='id'
            allowEmpty
          >
            <SelectInput optionText='device name' optionValue='id' />
          </ReferenceInput>
        </Row>

        <Row>
          <ReferenceInput
            label='Fleet'
            source='belongs to-application'
            reference='application'
            target='id'
            perPage={1000}
            sort={{ field: 'app name', order: 'ASC' }}
            filter={{ 'is of-class': 'fleet' }}
          >
            <SelectInput optionText='app name' optionValue='id' validate={required()} />
          </ReferenceInput>

          <FormDataConsumer>
            {({ formData, ...rest }) =>
              formData['belongs to-application'] && (
                <ReferenceInput
                  label='Target Release'
                  source={isPinnedOnRelease}
                  reference='release'
                  target='id'
                  filter={{ 'belongs to-application': formData['belongs to-application'] }}
                  allowEmpty
                >
                  <SelectInput optionText={(o) => getSemver(o)} optionValue='id' />
                </ReferenceInput>
              )
            }
          </FormDataConsumer>

          <SelectOperatingSystem label='Target OS' source='should be operated by-release' readOnly={true} />
        </Row>
      </SimpleForm>
    </Edit>
  );
};

const device = {
	list: DeviceList,
	create: DeviceCreate,
	edit: DeviceEdit,
	fleetGrouped: FleetGroupedDeviceList,
};

export default device;
