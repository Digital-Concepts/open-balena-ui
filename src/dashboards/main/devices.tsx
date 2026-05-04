import React from 'react';
import { useDataProvider } from 'react-admin';
import { Card, CardContent, Typography, Grid, Box } from '@mui/material';

interface FleetStat {
	fleetName: string;
	deviceCount: number;
	online: number;
	offline: number;
	lastReleaseVersion: string;
}

interface DeviceCounts {
	online: number;
	offline: number;
	total: number;
}

export const DeviceStats: React.FC = () => {
	const dataProvider = useDataProvider();
	const [, setFleetStats] = React.useState<FleetStat[]>([]);
	const [deviceStats, setDeviceStats] = React.useState<DeviceCounts>({
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
			const online = devices.data.filter(
				(d: any) => d['api heartbeat state'] === 'online',
			).length;
			const offline = devices.data.length - online;

			const stats: FleetStat[] = fleets.data.map((fleet: any) => {
				const fleetDevices = devices.data.filter(
					(d: any) => d['belongs to-application'] === fleet.id,
				);
				const fleetOnline = fleetDevices.filter(
					(d: any) => d['api heartbeat state'] === 'online',
				).length;
				const fleetOffline = fleetDevices.length - fleetOnline;

				const fleetReleases = releases.data
					.filter((r: any) => r['belongs to-application'] === fleet.id)
					.sort(
						(a: any, b: any) =>
							new Date(b['created at']).getTime() - new Date(a['created at']).getTime(),
					);
				const lastRelease = fleetReleases[0];
				const lastReleaseVersion = lastRelease?.contract?.version || 'N/A';
				return {
					fleetName: fleet['app name'],
					deviceCount: fleetDevices.length,
					online: fleetOnline,
					offline: fleetOffline,
					lastReleaseVersion,
				};
			});
			setDeviceStats({ online, offline, total: devices.data.length });
			setFleetStats(stats);
		});
	}, [dataProvider]);

	return (
		<Box>
			<Typography variant='h5' gutterBottom>
				Device Statistics
			</Typography>
			<Grid container spacing={2}>
				<Grid item xs={12} md={4}>
					<Card>
						<CardContent>
							<Typography variant='h6'>Total Devices</Typography>
							<Typography>{deviceStats.total}</Typography>
							<Typography color='success.main'>
								Online: {deviceStats.online}
							</Typography>
							<Typography color='error.main'>
								Offline: {deviceStats.offline}
							</Typography>
						</CardContent>
					</Card>
				</Grid>
			</Grid>
		</Box>
	);
};
