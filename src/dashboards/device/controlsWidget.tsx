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
import SendIcon from '@mui/icons-material/Send';
import {
	Box,
	Card,
	CardContent,
	CardActions,
	Typography,
	Button,
	Grid,
	FormControl,
	Select,
	MenuItem,
	type SelectChangeEvent,
} from '@mui/material';
import {
	EditButton,
	ReferenceField,
	TextField,
	useAuthProvider,
	useNotify,
	useRecordContext,
} from 'react-admin';
import type { RaRecord } from 'react-admin';
import { OnlineField } from '../../components/device';
import utf8decode from '../../lib/utf8decode';
import environment from '../../lib/reactAppEnv';
import { ConfirmationDialog, type ConfirmationDialogProps } from '../../ui/ConfirmationDialog';

type DeviceRecord = RaRecord & {
	'uuid': string;
	'device name': string;
	'api heartbeat state'?: string;
};

// Out-of-band tasks queued for the device to pull. Must match the dispatcher's
// KNOWN_TASKS (support-containers/task-dispatcher/app.py).
const TASK_COMMANDS = ['reboot', 'restart-vpn', 'upload-logs', 'upload-backup'] as const;

// Shared style for the action buttons: square-ish tiles with the icon stacked
// above a centered label, uniform height across a row (fullWidth in an equal
// 3-col grid).
const ACTION_BTN_SX = {
	flexDirection: 'column',
	gap: 0.25,
	py: 0.5,
	minHeight: 48,
	height: '100%',
	textAlign: 'center',
	lineHeight: 1.1,
	fontSize: '0.72rem',
	'& .MuiButton-startIcon': { margin: 0 },
	'& .MuiSvgIcon-root': { fontSize: 18 },
} as const;

const ControlsWidget: React.FC = () => {
	const authProvider = useAuthProvider();
	const notify = useNotify();
	const record = useRecordContext<DeviceRecord>();

	const [confirmationDialog, setConfirmationDialog] = React.useState<ConfirmationDialogProps | null>(null);
	const [taskName, setTaskName] = React.useState<string>('');

	const invokeSupervisor = async (device: DeviceRecord, command: string) => {
		const session = authProvider?.getSession?.();
		if (!session?.jwt) {
			notify('Error: Unable to execute command without a valid session', { type: 'error' });
			return;
		}
		try {
			const response = await fetch(
				`${environment.REACT_APP_OPEN_BALENA_API_URL}/supervisor/v1/${command}`,
				{
					method: 'POST',
					body: JSON.stringify({ uuid: device.uuid }),
					headers: new Headers({
						'Content-Type': 'application/json',
						Authorization: `Bearer ${session.jwt}`,
					}),
					insecureHTTPParser: true,
				} as RequestInit,
			);
			if (response.status < 200 || response.status >= 300) {
				throw new Error(response.statusText);
			}
			const body = response.body;
			if (!body) return;
			const streamData = await body.getReader().read();
			if (!streamData.value) return;
			const result = utf8decode(streamData.value);
			if (result === 'OK') {
				notify(`Successfully executed command ${command} on device ${device['device name']}`, {
					type: 'success',
				});
			}
		} catch {
			notify(`Error: Could not execute command ${command} on device ${device['device name']}`, { type: 'error' });
		}
	};

	const initiateLogDownload = async (device: DeviceRecord) => {
		const session = authProvider?.getSession?.();
		if (!session?.jwt) return;
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

	const controlLogLevel = async (device: DeviceRecord, logLevel: string) => {
		const session = authProvider?.getSession?.();
		if (!session?.jwt) return;
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
				notify(`Log level changed to ${logLevel} successfully`, { type: 'success' });
			} else {
				const errorData = await response.json().catch(() => ({}));
				notify(`Failed to change log level: ${errorData.error || response.statusText}`, { type: 'error' });
			}
		} catch (error) {
			console.error('Error while changing log level:', error);
			notify('An error occurred while changing log level', { type: 'error' });
		}
	};

	const controlSSH = async (device: DeviceRecord, status: 'on' | 'off') => {
		const session = authProvider?.getSession?.();
		if (!session?.jwt) return;
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
					status,
				}),
			});
			if (response.ok) {
				notify(`SSH ${status === 'on' ? 'enabled' : 'disabled'} successfully`, { type: 'success' });
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

	const uploadFiles = async (device: DeviceRecord) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;
		input.onchange = async (e: Event) => {
			const target = e.target as HTMLInputElement;
			const files = target.files;
			if (!files) return;
			const formData = new FormData();
			for (const file of Array.from(files)) {
				formData.append('files', file);
			}
			formData.append('uuid', device.uuid);
			formData.append('name', device['device name']?.split('-')[0] ?? '');
			formData.append('configPassword', device['device name']);

			const session = authProvider?.getSession?.();
			if (!session?.jwt) return;
			try {
				const response = await fetch('/send-files', {
					method: 'POST',
					headers: { Authorization: `Bearer ${session.jwt}` },
					body: formData,
				});
				if (!response.ok) throw new Error('Upload failed');
				notify('Files uploaded successfully', { type: 'success' });
			} catch (error) {
				console.error('Upload error:', error);
				notify('Failed to upload files', { type: 'error' });
			}
		};
		input.click();
	};

	const downloadFiles = async (device: DeviceRecord) => {
		const session = authProvider?.getSession?.();
		if (!session?.jwt) return;
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
				console.error('Failed to download files', response.statusText);
				alert('Failed to download Files. Please try again.');
			}
		} catch (error) {
			console.error('Error while downloading files', error);
			alert('An error occurred while downloading files. Please try again.');
		}
	};

	const downloadBackup = async (device: DeviceRecord) => {
		const session = authProvider?.getSession?.();
		if (!session?.jwt) return;
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

	const updateSupervisor = async (device: DeviceRecord) => {
		const session = authProvider?.getSession?.();
		if (!session?.jwt) return;
		try {
			const response = await fetch('/update-supervisor', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.jwt}`,
				},
				body: JSON.stringify({ uuid: device.uuid }),
			});
			if (response.ok) {
				const data = await response.json();
				notify(`Update supervisor command sent successfully: ${data.lastLine || ''}`, { type: 'success' });
				console.log(data.output);
			} else {
				const errorData = await response.json().catch(() => ({}));
				notify(`Failed to update supervisor: ${errorData.error || response.statusText}`, { type: 'error' });
			}
		} catch {
			notify('An error occurred while updating supervisor', { type: 'error' });
		}
	};

	const uploadIonos = async (device: DeviceRecord) => {
		const session = authProvider?.getSession?.();
		if (!session?.jwt) return;
		try {
			const response = await fetch('/upload-ionos', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.jwt}`,
				},
				body: JSON.stringify({
					uuid: device.uuid,
					configPassword: device['device name'],
				}),
			});
			if (response.ok) {
				const data = await response.json();
				notify(`Upload to Ionos command sent successfully: ${data.lastLine || ''}`, { type: 'success' });
				console.log(data.output);
			} else {
				const errorData = await response.json().catch(() => ({}));
				notify(`Failed to upload to Ionos: ${errorData.error || response.statusText}`, { type: 'error' });
			}
		} catch {
			notify('An error occurred while uploading to Ionos', { type: 'error' });
		}
	};

	// Queue an out-of-band task via the task-dispatcher (BFF injects the operator
	// token). Unlike the supervisor commands above, this does NOT require the
	// device to be online — it is the channel for offline / VPN-down devices.
	const sendTask = async (device: DeviceRecord, taskCommand: string) => {
		const session = authProvider?.getSession?.();
		if (!session?.jwt) {
			notify('Error: Unable to queue task without a valid session', { type: 'error' });
			return;
		}
		try {
			const response = await fetch('/task-dispatcher/command', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.jwt}`,
				},
				body: JSON.stringify({ name: taskCommand, device_name: device['device name'] }),
			});
			if (response.ok) {
				const data = await response.json().catch(() => ({}));
				notify(`Task "${taskCommand}" queued (task_id ${data.task_id ?? '?'})`, { type: 'success' });
			} else {
				const errorData = await response.json().catch(() => ({}));
				notify(`Failed to queue "${taskCommand}": ${errorData.error || errorData.message || response.statusText}`, {
					type: 'error',
				});
			}
		} catch (error) {
			console.error('Error while queuing task:', error);
			notify('An error occurred while queuing the task', { type: 'error' });
		}
	};

	if (!record) return null;

	const isOffline = record['api heartbeat state'] !== 'online';

	return (
		<>
			<Typography variant='h5' component='h2' gutterBottom>
				{record['device name']}
			</Typography>
			<Box maxWidth='40em'>
				<p style={{ marginBottom: '5px' }}>
					<b>Fleet: </b>
					<ReferenceField source='belongs to-application' reference='application' target='id'>
						<TextField source='app name' style={{ fontSize: '12pt' }} />
					</ReferenceField>
				</p>
				<p style={{ margin: 0 }}>
					<b>Status: </b>
					<OnlineField source='api heartbeat state' />
				</p>
			</Box>
			<Box sx={{ width: '100%' }}>
				<Grid container spacing={2}>
					{/* General Actions */}
					<Grid item xs={12} md={6}>
						<Card sx={{ height: '100%' }}>
							<CardContent>
								<Typography variant='body1' fontWeight='bold'>
									General
								</Typography>
							</CardContent>
							<CardActions>
								<Grid container spacing={1}>
									<Grid item xs={6}>
										<EditButton
											label='Edit'
											size='small'
											variant='outlined'
											color='secondary'
											fullWidth
											sx={ACTION_BTN_SX}
										/>
									</Grid>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => {
												setConfirmationDialog({
													title: 'Reboot Device',
													content: 'Are you sure you want to reboot this device?',
													onConfirm: () => invokeSupervisor(record, 'reboot'),
												});
											}}
											startIcon={<RestartAltIcon />}
											disabled={isOffline}
										>
											Reboot
										</Button>
									</Grid>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => invokeSupervisor(record, 'blink')}
											startIcon={<LightModeIcon />}
											disabled={isOffline}
										>
											Blink
										</Button>
									</Grid>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => updateSupervisor(record)}
											startIcon={<UpdateIcon />}
											disabled={isOffline}
										>
											Update Supervisor
										</Button>
									</Grid>
								</Grid>
							</CardActions>
						</Card>
					</Grid>
					{/* Logs Actions */}
					<Grid item xs={12} md={6}>
						<Card sx={{ height: '100%' }}>
							<CardContent>
								<Typography variant='body1' fontWeight='bold'>
									Logs
								</Typography>
							</CardContent>
							<CardActions>
								<Grid container spacing={1}>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => controlLogLevel(record, 'info')}
											startIcon={<FeedIcon />}
											disabled={isOffline}
										>
											Set to info
										</Button>
									</Grid>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => controlLogLevel(record, 'debug')}
											startIcon={<FeedOutlinedIcon />}
											disabled={isOffline}
										>
											Set to debug
										</Button>
									</Grid>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => initiateLogDownload(record)}
											startIcon={<DownloadIcon />}
											disabled={isOffline}
										>
											Download
										</Button>
									</Grid>
								</Grid>
							</CardActions>
						</Card>
					</Grid>
					{/* Files Actions */}
					<Grid item xs={12} md={6}>
						<Card sx={{ height: '100%' }}>
							<CardContent>
								<Typography variant='body1' fontWeight='bold'>
									Files
								</Typography>
							</CardContent>
							<CardActions>
								<Grid container spacing={1}>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => uploadFiles(record)}
											startIcon={<CloudUploadIcon />}
											disabled={isOffline}
										>
											Upload Files
										</Button>
									</Grid>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => downloadFiles(record)}
											startIcon={<CloudDownloadIcon />}
											disabled={isOffline}
										>
											Download Files
										</Button>
									</Grid>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => downloadBackup(record)}
											startIcon={<CloudDownloadIcon />}
											disabled={isOffline}
										>
											Download Backup
										</Button>
									</Grid>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => uploadIonos(record)}
											startIcon={<CloudUploadIcon />}
											disabled={isOffline}
										>
											Upload Backup to Ionos
										</Button>
									</Grid>
								</Grid>
							</CardActions>
						</Card>
					</Grid>
					{/* SSH Actions */}
					<Grid item xs={12} md={6}>
						<Card sx={{ height: '100%' }}>
							<CardContent>
								<Typography variant='body1' fontWeight='bold'>
									SSH
								</Typography>
							</CardContent>
							<CardActions>
								<Grid container spacing={1}>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => controlSSH(record, 'on')}
											startIcon={<SpeakerNotesIcon />}
											disabled={isOffline}
										>
											Enable SSH
										</Button>
									</Grid>
									<Grid item xs={6}>
										<Button
											fullWidth
											sx={ACTION_BTN_SX}
											variant='outlined'
											size='small'
											onClick={() => controlSSH(record, 'off')}
											startIcon={<SpeakerNotesOffIcon />}
											disabled={isOffline}
										>
											Disable SSH
										</Button>
									</Grid>
								</Grid>
							</CardActions>
						</Card>
					</Grid>
					{/* Task Channel — full width; out-of-band commands, deliberately NOT
					    disabled offline since this is the channel for offline / VPN-down devices. */}
					<Grid item xs={12}>
						<Card sx={{ height: '100%' }}>
							<CardContent sx={{ '&:last-child': { pb: 2 } }}>
								<Box display='flex' gap={2} alignItems='center' flexWrap='wrap'>
									<Typography variant='body1' fontWeight='bold' sx={{ mr: 1 }}>
										Task Channel
									</Typography>
									<FormControl size='small' sx={{ width: 200 }}>
										<Select
											displayEmpty
											value={taskName}
											onChange={(e: SelectChangeEvent) => setTaskName(e.target.value)}
											renderValue={(v) =>
												v ? (v as string) : <Box component='span' sx={{ color: 'text.secondary' }}>Command</Box>
											}
										>
											{TASK_COMMANDS.map((t) => (
												<MenuItem key={t} value={t}>
													{t}
												</MenuItem>
											))}
										</Select>
									</FormControl>
									<Button
										variant='outlined'
										size='small'
										startIcon={<SendIcon />}
										disabled={!taskName}
										sx={{ height: 40 }}
										onClick={() => {
											setConfirmationDialog({
												title: 'Queue Device Task',
												content: `Queue "${taskName}" for this device? It runs the next time the device polls (works while offline / VPN down).`,
												onConfirm: () => sendTask(record, taskName),
											});
										}}
									>
										Send
									</Button>
								</Box>
							</CardContent>
						</Card>
					</Grid>
				</Grid>
			</Box>
			{!!confirmationDialog && (
				<ConfirmationDialog {...confirmationDialog} onClose={() => setConfirmationDialog(null)} />
			)}
		</>
	);
};

export default ControlsWidget;
