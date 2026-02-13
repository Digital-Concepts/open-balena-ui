import React from 'react';
import LightModeIcon from '@mui/icons-material/LightMode';
import DownloadIcon from '@mui/icons-material/Download';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import FeedIcon from '@mui/icons-material/Feed';
import FeedOutlinedIcon from '@mui/icons-material/FeedOutlined';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import SpeakerNotesOffIcon from '@mui/icons-material/SpeakerNotesOff';
import SpeakerNotesIcon from '@mui/icons-material/SpeakerNotes';
import UpdateIcon from '@mui/icons-material/Update';
import {
	Box,
	Card,
	CardContent,
	CardActions,
	Typography,
	Button,
	Grid,
	ButtonGroup,
} from '@mui/material';
import {
	EditButton,
	FunctionField,
	ReferenceField,
	TextField,
	useAuthProvider,
	useNotify,
	useRecordContext,
} from 'react-admin';
import { OnlineField } from '../../components/device';
import utf8decode from '../../lib/utf8decode';
import environment from '../../lib/reactAppEnv';
import { ConfirmationDialog } from '../../ui/ConfirmationDialog';

const styles = {
	actionCard: {
		padding: 0,
		flexWrap: 'wrap',
		'& .MuiButton-root': {
			marginTop: '2em',
			marginRight: '1em',

			'.MuiButton-icon': {
				marginRight: '6px !important',
			},
		},
	},
};

const ControlsWidget = () => {
	const authProvider = useAuthProvider();
	const notify = useNotify();
	const record = useRecordContext();

	const [confirmationDialog, setConfirmationDialog] = React.useState(null);

	const invokeSupervisor = (device, command) => {
		const session = authProvider.getSession();
		return fetch(
			`${environment.REACT_APP_OPEN_BALENA_API_URL}/supervisor/v1/${command}`,
			{
				method: 'POST',
				body: JSON.stringify({ uuid: device.uuid }),
				headers: new Headers({
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.jwt}`,
				}),
				insecureHTTPParser: true,
			},
		)
			.then((response) => {
				if (response.status < 200 || response.status >= 300) {
					throw new Error(response.statusText);
				}
				return response.body
					.getReader()
					.read()
					.then((streamData) => {
						const result = utf8decode(streamData.value);
						if (result === 'OK')
							notify(
								`Successfully executed command ${command} on device ${device['device name']}`,
								{
									type: 'success',
								},
							);
					});
			})
			.catch(() => {
				notify(
					`Error: Could not execute command ${command} on device ${device['device name']}`,
					{ type: 'error' },
				);
			});
	};

	const initiateLogDownload = async (device) => {
		const session = authProvider.getSession();
		try {
			const response = await fetch('/download-logs', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.jwt}`,
				},
				body: JSON.stringify({
					uuid: device.uuid,
					name: device['device name']?.split('-')[0],
					configPassword: device['device name'],
				}),
			});

			if (response.ok) {
				const blob = await response.blob();
				const url = window.URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `logs_${device['device name']?.split('-')[0]}.zip`;
				document.body.appendChild(a);
				a.click();
				a.remove();
				window.URL.revokeObjectURL(url);
			} else {
				console.error('Failed to download logs', response.statusText);
				alert('Failed to download logs. Please try again.');
			}
		} catch (error) {
			console.error('Error while downloading logs', error);
			alert('An error occurred while downloading logs. Please try again.');
		}
	};

	const controlLogLevel = async (device, logLevel) => {
		const session = authProvider.getSession();
		try {
			const response = await fetch('/log-level', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.jwt}`,
				},
				body: JSON.stringify({
					uuid: device.uuid,
					password: device['device name'],
					logLevels: logLevel,
				}),
			});

			if (response.ok) {
				notify(`Log level changed to ${logLevel} successfully`, {
					type: 'success',
				});
			} else {
				const errorData = await response.json().catch(() => ({}));
				notify(
					`Failed to change log level: ${errorData.error || response.statusText}`,
					{ type: 'error' },
				);
			}
		} catch (error) {
			console.error('Error while changing log level:', error);
			notify('An error occurred while changing log level', { type: 'error' });
		}
	};

	const controlSSH = async (device, status) => {
		const session = authProvider.getSession();
		try {
			const response = await fetch('/control-ssh', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.jwt}`,
				},
				body: JSON.stringify({
					uuid: device.uuid,
					configPassword: device['device name'],
					status: status,
				}),
			});

			if (response.ok) {
				notify(`SSH ${status === 'on' ? 'enabled' : 'disabled'} successfully`, {
					type: 'success',
				});
			} else {
				const errorData = await response.json().catch(() => ({}));
				notify(
					`Failed to ${status === 'on' ? 'enable' : 'disable'} SSH: ${errorData.error || response.statusText}`,
					{ type: 'error' },
				);
			}
		} catch (error) {
			console.error('Error while changing SSH status:', error);
			notify('An error occurred while changing SSH status', { type: 'error' });
		}
	};

	const uploadFiles = async (device) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;

		input.onchange = async (e) => {
			const files = e.target.files;
			const formData = new FormData();

			for (let file of files) {
				formData.append('files', file);
			}
			formData.append('uuid', device.uuid);
			formData.append('name', device['device name']?.split('-')[0]);
			formData.append('configPassword', device['device name']);

			const session = authProvider.getSession();
			try {
				const response = await fetch('/send-files', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${session.jwt}`,
					},
					body: formData,
				});

				if (!response.ok) {
					throw new Error('Upload failed');
				}

				notify('Files uploaded successfully', { type: 'success' });
			} catch (error) {
				console.error('Upload error:', error);
				notify('Failed to upload files', { type: 'error' });
			}
		};

		input.click();
	};

	const downloadFiles = async (device) => {
		const session = authProvider.getSession();
		try {
			const response = await fetch('/download-files', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.jwt}`,
				},
				body: JSON.stringify({
					uuid: device.uuid,
					name: device['device name']?.split('-')[0],
					configPassword: device['device name'],
				}),
			});

			if (response.ok) {
				const blob = await response.blob();
				const url = window.URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `outbound_${device['device name']?.split('-')[0]}.zip`;
				document.body.appendChild(a);
				a.click();
				a.remove();
				window.URL.revokeObjectURL(url);
			} else {
				console.error('Failed to download logs', response.statusText);
				alert('Failed to download Files. Please try again.');
			}
		} catch (error) {
			console.error('Error while downloading logs', error);
			alert('An error occurred while downloading logs. Please try again.');
		}
	};

	const downloadBackup = async (device) => {
		const session = authProvider.getSession();
		try {
			const response = await fetch('/download-backup', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.jwt}`,
				},
				body: JSON.stringify({
					uuid: device.uuid,
					name: device['device name']?.split('-')[0],
					configPassword: device['device name'],
				}),
			});

			if (response.ok) {
				const blob = await response.blob();
				const url = window.URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `outbound_${device['device name']?.split('-')[0]}.zip`;
				document.body.appendChild(a);
				a.click();
				a.remove();
				window.URL.revokeObjectURL(url);
			} else {
				console.error('Failed to download backup', response.statusText);
				alert('Failed to download backup. Please try again.');
			}
		} catch (error) {
			console.error('Error while downloading backup', error);
			alert('An error occurred while downloading backup. Please try again.');
		}
	};
	const updateSupervisor = async (device) => {
		const session = authProvider.getSession();
		try {
			const response = await fetch("/update-supervisor", {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${session.jwt}`,
					},
					body: JSON.stringify({
						uuid: device.uuid,
					}),
				},
			);
			if (response.ok) {
				const data = await response.json();
				notify(
					`Update supervisor command sent successfully: ${data.lastLine || ''}`,
					{ type: 'success' },
				);

				console.log(data.output);
			} else {
				const errorData = await response.json().catch(() => ({}));
				notify(
					`Failed to update supervisor: ${errorData.error || response.statusText}`,
					{ type: 'error' },
				);
			}
		} catch (error) {
			notify('An error occurred while updating supervisor', { type: 'error' });
		}
	};
	const uploadIonos = async (device) => {
		const session = authProvider.getSession();
		try {
			const response = await fetch("/upload-ionos", {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${session.jwt}`,
					},
					body: JSON.stringify({
						uuid: device.uuid,
						configPassword: device['device name'],
					}),
				},
			);
			if (response.ok) {
				const data = await response.json();
				notify(
					`Upload to Ionos command sent successfully: ${data.lastLine || ''}`,
					{ type: 'success' },
				);

				console.log(data.output);
			} else {
				const errorData = await response.json().catch(() => ({}));
				notify(
					`Failed to upload to Ionos<: ${errorData.error || response.statusText}`,
					{ type: 'error' },
				);
			}
		} catch (error) {
			notify('An error occurred while uploading to Ionos', { type: 'error' });
		}
	};
	if (!record) return null;

	const isOffline = record['api heartbeat state'] !== 'online';

	return (
		<>
			<Typography variant="h5" component="h2" gutterBottom>
				{record['device name']}
			</Typography>
			<Box maxWidth="40em">
				<p style={{ marginBottom: '5px' }}>
					<b>Fleet: </b>
					<ReferenceField
						source="belongs to-application"
						reference="application"
						target="id"
					>
						<TextField source="app name" style={{ fontSize: '12pt' }} />
					</ReferenceField>
				</p>
				<p style={{ margin: 0 }}>
					<b>Status: </b>
					<OnlineField source="api heartbeat state" />
				</p>
			</Box>
			<Box sx={{ width: '100%' }}>
				<Grid container spacing={2}>
					{/* General Actions */}
					<Grid item xs={12} md={6}>
						<Card>
							<CardContent>
								<Typography variant="body1" fontWeight="bold">
									General
								</Typography>
							</CardContent>
							<CardActions>
								<Grid container direction="column" spacing={2}>
									<Grid item>
										{/* Row 1 */}
										<Box display="flex" gap={1}>
											<EditButton
												label="Edit"
												size="small"
												variant="outlined"
												color="secondary"
											/>
											<Button
												variant="outlined"
												size="small"
												onClick={() => {
													setConfirmationDialog({
														title: 'Reboot Device',
														content:
															'Are you sure you want to reboot this device?',
														onConfirm: () => invokeSupervisor(record, 'reboot'),
													});
												}}
												startIcon={<RestartAltIcon />}
												disabled={isOffline}
											>
												Reboot
											</Button>
										</Box>
									</Grid>
									<Grid item>
										{/* Row 2 */}
										<Box display="flex" gap={1}>
											<Button
												variant="outlined"
												size="small"
												onClick={() => invokeSupervisor(record, 'blink')}
												startIcon={<LightModeIcon />}
												disabled={isOffline}
											>
												Blink
											</Button>
											<Button
												variant="outlined"
												size="small"
												onClick={() => updateSupervisor(record)}
												startIcon={<UpdateIcon />}
												disabled={isOffline}
											>
												Update Supervisor
											</Button>
										</Box>
									</Grid>
								</Grid>
							</CardActions>
						</Card>
					</Grid>
					{/* Logs Actions */}
					<Grid item xs={12} md={6}>
						<Card>
							<CardContent>
								<Typography variant="body1" fontWeight="bold">
									Logs
								</Typography>
							</CardContent>
							<CardActions>
								<Grid container direction="column" spacing={2}>
									<Grid item>
										{/* Row 1 */}
										<Box display="flex" gap={1}>
											<Button
												variant="outlined"
												size="small"
												onClick={() => controlLogLevel(record, 'info')}
												startIcon={<FeedIcon />}
												disabled={isOffline}
											>
												Set to info
											</Button>
											<Button
												variant="outlined"
												size="small"
												onClick={() => controlLogLevel(record, 'debug')}
												startIcon={<FeedOutlinedIcon />}
												disabled={isOffline}
											>
												Set to debug
											</Button>
										</Box>
									</Grid>
									<Grid item>
										{/* Row 2 */}
										<Box display="flex" gap={1}>
											<Button
												variant="outlined"
												size="small"
												onClick={() => initiateLogDownload(record)}
												startIcon={<DownloadIcon />}
												disabled={isOffline}
											>
												Download
											</Button>
										</Box>
									</Grid>
								</Grid>
							</CardActions>
						</Card>
					</Grid>
					{/* Files Actions */}
					<Grid item xs={12} md={6}>
						<Card>
							<CardContent>
								<Typography variant="body1" fontWeight="bold">
									Files
								</Typography>
							</CardContent>
							<CardActions>
								<Grid container direction="column" spacing={2}>
									<Grid item>
										{/* Row 1 */}
										<Box display="flex" gap={1}>
										<Button
											variant="outlined"
											size="small"
											onClick={() => uploadFiles(record)}
											startIcon={<CloudUploadIcon />}
											disabled={isOffline}
										>
											Upload Files
										</Button>
										<Button
											variant="outlined"
											size="small"
											onClick={() => downloadFiles(record)}
											startIcon={<CloudDownloadIcon />}
											disabled={isOffline}
										>
											Download Files
										</Button>
										</Box>
									</Grid>
								<Grid item>
										{/* Row 2 */}
										<Box display="flex" gap={1}>
										<Button
											variant="outlined"
											size="small"
											onClick={() => downloadBackup(record)}
											startIcon={<CloudDownloadIcon />}
											disabled={isOffline}
										>
											Download Backup
										</Button>
										<Button
											variant="outlined"
											size="small"
											onClick={() => uploadIonos(record)}
											startIcon={<CloudUploadIcon />}
											disabled={isOffline}
										>
											Upload Backup to Ionos
										</Button>
										</Box>
										</Grid>
								</Grid>
							</CardActions>
						</Card>
					</Grid>
					{/* SSH Actions */}
					<Grid item xs={12} md={6}>
						<Card>
							<CardContent>
								<Typography variant="body1" fontWeight="bold">
									SSH
								</Typography>
							</CardContent>
							<CardActions>
								<Button
									variant="outlined"
									size="small"
									onClick={() => controlSSH(record, 'on')}
									startIcon={<SpeakerNotesIcon />}
									disabled={isOffline}
								>
									Enable SSH
								</Button>
								<Button
									variant="outlined"
									size="small"
									onClick={() => controlSSH(record, 'off')}
									startIcon={<SpeakerNotesOffIcon />}
									disabled={isOffline}
								>
									Disable SSH
								</Button>
							</CardActions>
						</Card>
					</Grid>
				</Grid>
			</Box>
			{!!confirmationDialog && (
				<ConfirmationDialog
					{...confirmationDialog}
					onClose={() => setConfirmationDialog(null)}
				/>
			)}
		</>
	);
};

export default ControlsWidget;
