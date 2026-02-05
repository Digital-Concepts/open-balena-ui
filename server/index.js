const express = require('express');
const registryImageRoutes = require('./routes/registryImage');
const { getReactAppEnv } = require('./controller/appEnvironment');
const serialListRoutes = require('./routes/serialList');
const jwt = require('njwt');
require('dotenv').config();
const fetch = (...args) =>
	import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const portfinder = require('portfinder');
const waitPort = require('wait-port');
const { spawn, execSync, exec } = require('child_process');
const multer = require('multer');
const upload = multer({ dest: '/tmp/uploads/' });
const path = require('path');

const PORT = parseInt(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const app = express();
app.use(express.json());

app.use('/', registryImageRoutes);
app.use('/', serialListRoutes);
app.get('/environment.js', getReactAppEnv);
app.get('*', express.static('dist'));

// Create session directory
async function createSessionDir(uuid) {
	const sessionDir = `/tmp/sessions/${uuid}`;
	fs.mkdirSync(sessionDir, { recursive: true });
	return sessionDir;
}

// login to Balena
async function balenaLogin(token, sessionDir) {
	const loginCmd = `/usr/bin/balena login --token ${token} --unsupported`;
	return await new Promise((resolve, reject) => {
		exec(
			loginCmd,
			{ env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir } },
			(error, stdout, stderr) => {
				if (error) {
					console.error('Login failed:', error.message);
					fs.rmSync(sessionDir, { recursive: true, force: true });
					reject(new Error('Failed to authenticate with Balena'));
				} else {
					console.log('Login successful:', stdout.toString());
					resolve();
				}
			},
		);
	});
}

// Open Balena tunnel
async function openTunnel(uuid, portMap, sessionDir) {
	const tunnelPort = await portfinder.getPortPromise({
		port: 20000,
		stopPort: 29999,
	});
	const tunnelCmd = `/usr/bin/balena device tunnel ${uuid} -p ${portMap}:${tunnelPort} --unsupported`;
	const tunnelProcess = spawn(tunnelCmd, {
		shell: true,
		env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir },
	});

	tunnelProcess.stdout.on('data', (data) => {
		console.log(`Tunnel stdout: ${data}`);
	});
	tunnelProcess.stderr.on('data', (data) => {
		console.error(`Tunnel stderr: ${data}`);
	});

	await waitForPort(tunnelPort);
	return { tunnelProcess, tunnelPort };
}

// Helper to wait for port
async function waitForPort(port) {
	const portOpen = await waitPort({ host: '127.0.0.1', port, timeout: 20000 });
	if (!portOpen) {
		throw new Error('Failed to open tunnel');
	}
}

// Cleanup tunnel and session
function cleanupTunnelAndSession(tunnelProcess, sessionDir) {
	if (tunnelProcess?.pid) {
		try {
			process.kill(tunnelProcess.pid);
		} catch (error) {
			console.error('Error killing tunnel process:', error);
		}
	}
	if (sessionDir) {
		fs.rmSync(sessionDir, { recursive: true, force: true });
	}
}

app.post('/download-logs', async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid, password } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		const { tunnelProcess: tp, tunnelPort } = await openTunnel(
			uuid,
			'8080:127.0.0.1',
			sessionDir,
		);
		tunnelProcess = tp;

		const logResponse = await fetch(
			`http://127.0.0.1:${tunnelPort}/system/logfiles`,
			{
				method: 'GET',
				headers: {
					Authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`,
				},
			},
		);

		if (!logResponse.ok) {
			cleanupTunnelAndSession(tunnelProcess, sessionDir);
			return res
				.status(logResponse.status)
				.json({ error: 'Failed to fetch logs' });
		}

		logResponse.body.on('error', (err) => {
			console.error('Stream error:', err);
			if (!res.headersSent) {
				res.status(500).json({ error: 'Error streaming logs' });
			}
			cleanupTunnelAndSession(tunnelProcess, sessionDir);
		});

		res.on('close', () => {
			console.log('Client disconnected');
			cleanupTunnelAndSession(tunnelProcess, sessionDir);
		});

		res.setHeader(
			'Content-Disposition',
			`attachment; filename="logs_${password}.zip"`,
		);
		res.setHeader('Content-Type', 'application/zip');
		logResponse.body.pipe(res);
	} catch (error) {
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.error('Error during log download', error);
		res.status(500).json({ error: 'An error occurred while downloading logs' });
	}
});

app.post('/log-level', async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid, password, logLevels } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		const { tunnelProcess: tp, tunnelPort } = await openTunnel(
			uuid,
			'8099:127.0.0.1',
			sessionDir,
		);
		tunnelProcess = tp;

		const logResponse = await fetch(
			`http://127.0.0.1:${tunnelPort}/system/config/loglevel`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Basic ${Buffer.from(`ConfigUser:${password}`).toString('base64')}`,
				},
				body: JSON.stringify({ logLevel: logLevels }),
			},
		);

		if (!logResponse.ok) {
			cleanupTunnelAndSession(tunnelProcess, sessionDir);
			console.error('Failed to update log level:', logResponse.statusText);
			return res.status(logResponse.status).json({
				error: `Failed to update log level: ${logResponse.statusText}`,
			});
		}

		const responseData = await logResponse.json();
		res.json({ success: true, data: responseData });
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.log('Client disconnected');
	} catch (error) {
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.error('Error during log level change:', error.message);
		res
			.status(500)
			.json({ error: 'An error occurred while changing log level' });
	}
});

app.post('/control-ssh', async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid, password, status } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		const { tunnelProcess: tp, tunnelPort } = await openTunnel(
			uuid,
			'8099:127.0.0.1',
			sessionDir,
		);
		tunnelProcess = tp;

		const logResponse = await fetch(
			`http://127.0.0.1:${tunnelPort}/system/config/ssh`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Basic ${Buffer.from(`ConfigUser:${password}`).toString('base64')}`,
				},
				body: JSON.stringify({ state: status }),
			},
		);

		if (!logResponse.ok) {
			cleanupTunnelAndSession(tunnelProcess, sessionDir);
			console.error('Failed to change SSH status:', logResponse.statusText);
			return res.status(logResponse.status).json({
				error: `Failed to change SSH status: ${logResponse.statusText}`,
			});
		}

		const responseData = await logResponse.json();
		res.json({ success: true, data: responseData });
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.log('Client disconnected');
	} catch (error) {
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.error('Error during SSH status change:', error.message);
		res
			.status(500)
			.json({ error: 'An error occurred while changing SSH status' });
	}
});

app.post('/send-files', upload.array('files'), async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid, password } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		const { tunnelProcess: tp, tunnelPort } = await openTunnel(
			uuid,
			'12738:127.0.0.1',
			sessionDir,
		);
		tunnelProcess = tp;

		for (const file of req.files) {
			const scpCommand = `scp -i /certs/tunnelKey/tunnelKey -P ${tunnelPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${file.path} root@127.0.0.1:/opt/spaceport/${file.originalname}`;
			await new Promise((resolve, reject) => {
				exec(scpCommand, (error, stdout, stderr) => {
					if (error) {
						console.error(`SCP error: ${error}`);
						reject(error);
					} else {
						console.log(`File transferred: ${file.originalname}`);
						resolve();
					}
					fs.unlinkSync(file.path);
				});
			});
		}

		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.log('Client disconnected');
		res.json({ success: true, message: 'Files uploaded successfully' });
	} catch (error) {
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.error('Error during file transfer:', error.message);
		res.status(500).json({
			error: `An error occurred while transferring files: ${error.message}`,
		});
	}
});

app.post('/download-files', async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid, password } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		const { tunnelProcess: tp, tunnelPort } = await openTunnel(
			uuid,
			'12738:127.0.0.1',
			sessionDir,
		);
		tunnelProcess = tp;

		const downloadPath = `/tmp/sessions/${uuid}/download_${Date.now()}`;
		fs.mkdirSync(downloadPath, { recursive: true });

		const scpCommand = `scp -i /certs/tunnelKey/tunnelKey -P ${tunnelPort} -r -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1:/opt/spaceport/outbound/* ${downloadPath}/`;
		await new Promise((resolve, reject) => {
			exec(scpCommand, (error, stdout, stderr) => {
				if (error) {
					console.error(`SCP error: ${error}`);
					reject(error);
				} else {
					console.log('Files downloaded successfully');
					resolve();
				}
			});
		});

		const zipFile = `/tmp/sessions/${uuid}/outbound_${Date.now()}.zip`;
		await new Promise((resolve, reject) => {
			exec(
				`cd ${downloadPath} && zip -r ${zipFile} .`,
				(error, stdout, stderr) => {
					if (error) {
						console.error(`Zip error: ${error}`);
						reject(error);
					} else {
						resolve();
					}
				},
			);
		});

		res.setHeader(
			'Content-Disposition',
			`attachment; filename="outbound_${password}.zip"`,
		);
		res.setHeader('Content-Type', 'application/zip');

		const fileStream = fs.createReadStream(zipFile);
		fileStream.pipe(res);

		fileStream.on('end', () => {
			fs.rmSync(downloadPath, { recursive: true, force: true });
			fs.unlinkSync(zipFile);
			cleanupTunnelAndSession(tunnelProcess, sessionDir);
		});
	} catch (error) {
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.error('Error during file download:', error);
		res
			.status(500)
			.json({ error: 'An error occurred while downloading files' });
	}
});

app.post('/update-supervisor', async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		const { tunnelProcess: tp, tunnelPort } = await openTunnel(
			uuid,
			'22222:127.0.0.1',
			sessionDir,
		);
		tunnelProcess = tp;

		const command = `ssh -i /certs/tunnelKey/tunnelKey -p ${tunnelPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1 "/usr/bin/update-balena-supervisor"`;

		const output = await new Promise((resolve, reject) => {
			exec(command, (error, stdout, stderr) => {
				if (error) {
					console.error(`SSH error: ${error}`);
					reject(stderr || error.message);
				} else {
					console.log('Update supervisor command sent');
					resolve(stdout || stderr);
				}
			});
		});

		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.log('Client disconnected');
		const lines = output.trim().split('\n');
		const lastLine = lines[lines.length - 1];
		res.json({
			success: true,
			message: 'Update supervisor command sent',
			output,
			lastLine,
		});
	} catch (error) {
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.error('Error during Supervisor update:', error);
		res
			.status(500)
			.json({
				error: 'An error occurred while updating Supervisor',
				details: error,
			});
	}
});

app.post('/download-backup', async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid, password } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		const { tunnelProcess: tp, tunnelPort } = await openTunnel(
			uuid,
			'12738:127.0.0.1',
			sessionDir,
		);
		tunnelProcess = tp;

		const downloadPath = `/tmp/sessions/${uuid}/download_${Date.now()}`;
		fs.mkdirSync(downloadPath, { recursive: true });

		const scpCommand = `scp -i /certs/tunnelKey/tunnelKey -P ${tunnelPort} -r -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1:/backup/backup_* ${downloadPath}/`;
		await new Promise((resolve, reject) => {
			exec(scpCommand, (error, stdout, stderr) => {
				if (error) {
					console.error(`SCP error: ${error}`);
					reject(error);
				} else {
					console.log('Files downloaded successfully');
					resolve();
				}
			});
		});
		const zipFile = `/tmp/sessions/${uuid}/backup_${Date.now()}.zip`;
		await new Promise((resolve, reject) => {
			exec(
				`cd ${downloadPath} && zip -r ${zipFile} .`,
				(error, stdout, stderr) => {
					if (error) {
						console.error(`Zip error: ${error}`);
						reject(error);
					} else {
						resolve();
					}
				},
			);
		});

		res.setHeader(
			'Content-Disposition',
			`attachment; filename="outbound_${password}.zip"`,
		);
		res.setHeader('Content-Type', 'application/zip');

		const fileStream = fs.createReadStream(zipFile);
		fileStream.pipe(res);

		fileStream.on('end', () => {
			fs.rmSync(downloadPath, { recursive: true, force: true });
			fs.unlinkSync(zipFile);
			cleanupTunnelAndSession(tunnelProcess, sessionDir);
		});
	} catch (error) {
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.error('Error during file download:', error);
		res
			.status(500)
			.json({ error: 'An error occurred while downloading files' });
	}
});


app.listen(PORT, HOST);
console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);
