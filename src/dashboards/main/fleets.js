import React from 'react';
import {
	ChipField,
	FunctionField,
	List,
	ReferenceField,
	ReferenceManyCount,
	ResourceContextProvider,
	SearchInput,
	WithListContext,
	useDataProvider,
} from 'react-admin';
import AddIcon from '@mui/icons-material/Add';
import CorporateFareIcon from '@mui/icons-material/CorporateFare';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoard';
import DevicesIcon from '@mui/icons-material/Devices';
import {
	Button,
	Card,
	CardActions,
	CardContent,
	CardHeader,
	Grid,
	Table,
	TableBody,
	TableCell,
	TableRow,
	Tooltip,
} from '@mui/material';
import { tableCellClasses } from '@mui/material/TableCell';
import { EditButton } from 'react-admin';
import EnvVarButton from '../../ui/EnvVarButton';
import { getSemver } from '../../ui/SemVerChip';
import versions from '../../versions';
import environment from '../../lib/reactAppEnv';

const isPinnedOnRelease = versions.resource(
	'isPinnedOnRelease',
	environment.REACT_APP_OPEN_BALENA_API_VERSION,
);

const fleetCardFilters = [
	<SearchInput source="#app name,is of-class@ilike" alwaysOn />,
];

export const FleetCards = () => {
	const dataProvider = useDataProvider();
	const [fleetStats, setFleetStats] = React.useState([]);

	React.useEffect(() => {
		Promise.all([
			dataProvider.getList('device', {
				pagination: { page: 1, perPage: 1000 },
				sort: { field: 'id', order: 'ASC' },
				filter: {},
			}),
			dataProvider.getList('application', {
				pagination: { page: 1, perPage: 1000 },
				sort: { field: 'id', order: 'ASC' },
				filter: {},
			}),
			dataProvider.getList('release', {
				pagination: { page: 1, perPage: 1000 },
				sort: { field: 'created at', order: 'DESC' },
				filter: {},
			}),
		]).then(([devices, fleets, releases]) => {
			const stats = fleets.data.map((fleet) => {
				const fleetDevices = devices.data.filter(
					(d) => d['belongs to-application'] === fleet.id,
				);
				const online = fleetDevices.filter(
					(d) => d['api heartbeat state'] === 'online',
				).length;
				const offline = fleetDevices.length - online;
				const fleetReleases = releases.data
					.filter((r) => r['belongs to-application'] === fleet.id)
					.sort(
						(a, b) => new Date(b['created at']) - new Date(a['created at']),
					);
				const lastRelease = fleetReleases[0];
				const lastReleaseVersion = lastRelease?.contract?.version || 'N/A';
				return {
					id: fleet.id,
					fleetName: fleet['app name'],
					deviceCount: fleetDevices.length,
					online,
					offline,
					lastReleaseVersion,
					record: fleet,
				};
			});
			setFleetStats(stats);
		});
	}, [dataProvider]);

	return (
		<ResourceContextProvider value="application">
			<List
				emptyWhileLoading
				disableSyncWithLocation
				filters={fleetCardFilters}
				title=" "
			>
				<WithListContext
					render={({ data }) => (
						<Card sx={{ flex: '1', dispay: 'flex', flexDirection: 'column' }}>
							<CardHeader title="Fleets" />
							<CardContent
								sx={{
									minHeight: 225,
									overflow: 'auto',
									flex: '1',
									display: 'flex',
									flexDirection: 'column',
								}}
							>
								<Grid container spacing={3} sx={{ flex: '1' }}>
									{fleetStats.map((fleet) => (
										<Grid item key={fleet.id} xs="auto">
											<Card
												sx={{
													minWidth: 300,
													maxWidth: 300,
													minHeight: 220,
													maxHeight: 320,
												}}
											>
												<CardHeader
													title={
														<Tooltip title={fleet.fleetName}>
															<span>{fleet.fleetName}</span>
														</Tooltip>
													}
													sx={{ fontWeight: 'bold', height: '45px' }}
													titleTypographyProps={{
														variant: 'inherit',
														whiteSpace: 'nowrap',
														overflow: 'hidden',
														textOverflow: 'ellipsis',
														maxWidth: 165,
													}}
												/>
												<CardContent
													sx={{ paddingTop: '4px', paddingBottom: '4px' }}
												>
													<Table
														sx={{
															[`& .${tableCellClasses.root}`]: {
																borderBottom: 'none',
																paddingLeft: '0px',
																paddingRight: '0px',
																paddingTop: '2px',
																paddingBottom: '2px',
															},
														}}
													>
														<TableBody>
															<TableRow>
																<TableCell colSpan={2}>
																	<ReferenceField
																		record={fleet.record}
																		source="organization"
																		reference="organization"
																		target="id"
																	>
																		<ChipField
																			icon={<CorporateFareIcon />}
																			source="name"
																			variant="outlined"
																			style={{
																				width: '100%',
																				justifyContent: 'space-between',
																				paddingLeft: '5px',
																			}}
																		/>
																	</ReferenceField>
																</TableCell>
															</TableRow>
															<TableRow>
																<TableCell colSpan={2}>
																	<ReferenceField
																		record={fleet.record}
																		source="is for-device type"
																		reference="device type"
																		target="id"
																	>
																		<ChipField
																			icon={<DeveloperBoardIcon />}
																			source="name"
																			variant="outlined"
																			style={{
																				width: '100%',
																				justifyContent: 'space-between',
																				paddingLeft: '5px',
																			}}
																		/>
																	</ReferenceField>
																</TableCell>
															</TableRow>
															<TableRow>
																<TableCell sx={{ fontWeight: 'bold' }}>
																	Last Release
																</TableCell>
																<TableCell align="right">
																	<b>{fleet.lastReleaseVersion}</b>
																</TableCell>
															</TableRow>
															<TableRow>
																<TableCell
																	sx={{
																		color: 'success.main',
																		fontWeight: 'bold',
																	}}
																>
																	Online
																</TableCell>
																<TableCell
																	align="right"
																	sx={{ color: 'success.main' }}
																>
																	{fleet.online}
																</TableCell>
															</TableRow>
															<TableRow>
																<TableCell
																	sx={{
																		color: 'error.main',
																		fontWeight: 'bold',
																	}}
																>
																	Offline
																</TableCell>
																<TableCell
																	align="right"
																	sx={{ color: 'error.main' }}
																>
																	{fleet.offline}
																</TableCell>
															</TableRow>
															<TableRow>
																<TableCell sx={{ fontWeight: 'bold' }}>
																	Total
																</TableCell>
																<TableCell align="right">
																	{fleet.deviceCount}
																</TableCell>
															</TableRow>
														</TableBody>
													</Table>
												</CardContent>
												<CardActions
													sx={{ paddingTop: '0px', paddingBottom: '4px' }}
												>
													<Button
														href={`/#/device?filter={"belongs to-application": ${fleet['id']}}`}
														size="small"
														variant="outlined"
														style={{ minWidth: '0' }}
													>
														<DevicesIcon />
													</Button>

													<Button
														href={`/#/device/create?source={"belongs to-application": ${fleet['id']}}`}
														size="small"
														variant="outlined"
														style={{ minWidth: '0' }}
													>
														<AddIcon />
													</Button>

													<EditButton
														record={fleet.record}
														label=""
														size="small"
														variant="outlined"
														style={{ minWidth: '0' }}
													/>

													<EnvVarButton
														resource="application"
														record={fleet.record}
														label=""
														size="small"
														variant="outlined"
														style={{ minWidth: '0' }}
													/>
												</CardActions>
											</Card>
										</Grid>
									))}
								</Grid>
							</CardContent>
						</Card>
					)}
				/>
			</List>
		</ResourceContextProvider>
	);
};
