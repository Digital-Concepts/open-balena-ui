import React from 'react';
import { WithListContext, ReferenceField, useDataProvider } from 'react-admin';
import { Card, CardContent, Typography, Grid, Box, Chip } from '@mui/material';

export const DeviceStats = () => {
	const dataProvider = useDataProvider();
	const [fleetStats, setFleetStats] = React.useState([]);
	const [deviceStats, setDeviceStats] = React.useState({
		online: 0,
		offline: 0,
		total: 0,
	});

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
			//online/offline
			const online = devices.data.filter(
				(d) => d['api heartbeat state'] === 'online',
			).length;
			const offline = devices.data.length - online;
		
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
				console.log('Fleet:', fleet['app name'], 'Releases:', fleetReleases[0]);
				return {
					fleetName: fleet['app name'],
					deviceCount: fleetDevices.length,
					online,
					offline,
					lastReleaseVersion,
				};
			});
			setDeviceStats({ online, offline, total: devices.data.length });
			setFleetStats(stats);
		});
	}, [dataProvider]);

	return (
		<Box>
			<Typography variant="h5" gutterBottom>
				Device Statistics
			</Typography>
			<Grid container spacing={2}>
				<Grid item xs={12} md={4}>
					<Card>
						<CardContent>
							<Typography variant="h6">Total Devices</Typography>
							<Typography>{deviceStats.total}</Typography>
							<Typography color="success.main">
								Online: {deviceStats.online}
							</Typography>
							<Typography color="error.main">
								Offline: {deviceStats.offline}
							</Typography>
						</CardContent>
					</Card>
				</Grid>
			</Grid>
		</Box>
	);
};
