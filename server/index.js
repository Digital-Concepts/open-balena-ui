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

// Cleanup only the tunnel process, leaving the session directory intact
function cleanupTunnel(tunnelProcess) {
	if (tunnelProcess?.pid) {
		try {
			process.kill(tunnelProcess.pid);
		} catch (error) {
			console.error('Error killing tunnel process:', error);
		}
	}
}

// Shared helper to change SSH state via config API
async function setSshState(uuid, configPassword, state, sessionDir) {
	let tunnelProcess;

	try {
		// Separate session/tunnel for the config API
		const { tunnelProcess: tp, tunnelPort } = await openTunnel(
			uuid,
			'8099:127.0.0.1',
			sessionDir,
		);
		tunnelProcess = tp;

		const sshResponse = await fetch(
			`http://127.0.0.1:${tunnelPort}/system/config/ssh`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Basic ${Buffer.from(`ConfigUser:${configPassword}`).toString('base64')}`,
				},
				body: JSON.stringify({ state }),
			},
		);

		if (!sshResponse.ok) {
			const message = `Failed to change SSH status: ${sshResponse.statusText}`;
			console.error(message);
			const error = new Error(message);
			error.status = sshResponse.status;
			throw error;
		}

		return await sshResponse.json();
	} finally {
		// Only stop the SSH-config tunnel; keep the session dir so
		// other operations in the same request can reuse the login.
		cleanupTunnel(tunnelProcess);
	}
}

app.post('/download-logs', async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid, name, configPassword } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		await setSshState(uuid, configPassword, 'on', sessionDir);
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
					Authorization: `Basic ${Buffer.from(`admin:${name}`).toString('base64')}`,
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
		});

		res.on('close', () => {
			console.log('Client disconnected');

			(async () => {
				try {
					await setSshState(uuid, configPassword, 'off', sessionDir);
					console.log('SSH disabled after logs');
				} catch (err) {
					console.error('Failed to disable SSH after logs:', err.message || err);
				} finally {
					cleanupTunnelAndSession(tunnelProcess, sessionDir);
				}
			})();
		});

		res.setHeader(
			'Content-Disposition',
			`attachment; filename="logs_${name}.zip"`,
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
	try {
		const { uuid, configPassword, status } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		const responseData = await setSshState(uuid, configPassword, status, sessionDir);
		res.json({ success: true, data: responseData });
		console.log('SSH status changed');
	} catch (error) {
		console.error('Error during SSH status change:', error.message || error);
		const status = error.status || 500;
		if (error.status) {
			res.status(status).json({ error: error.message });
		} else {
			res
				.status(status)
				.json({ error: 'An error occurred while changing SSH status' });
		}
	}
});

app.post('/send-files', upload.array('files'), async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid, name, configPassword } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		await setSshState(uuid, configPassword, 'on', sessionDir);
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

		console.log('Client disconnected');
		res.json({ success: true, message: 'Files uploaded successfully' });

		(async () => {
			try {
				await setSshState(uuid, configPassword, 'off', sessionDir);
				console.log('SSH disabled after upload');
			} catch (err) {
				console.error('Failed to disable SSH after upload:', err.message || err);
			} finally {
				cleanupTunnelAndSession(tunnelProcess, sessionDir);
			}
		})();
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
		const { uuid, name, configPassword} = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		await setSshState(uuid, configPassword, 'on', sessionDir);
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
			`attachment; filename="outbound_${name}.zip"`,
		);
		res.setHeader('Content-Type', 'application/zip');

		const fileStream = fs.createReadStream(zipFile);
		fileStream.pipe(res);

		fileStream.on('end', () => {
			fs.rmSync(downloadPath, { recursive: true, force: true });
			fs.unlinkSync(zipFile);

			(async () => {
				try {
					await setSshState(uuid, configPassword, 'off', sessionDir);
					console.log('SSH disabled after download');
				} catch (err) {
					console.error('Failed to disable SSH after download:', err.message || err);
				} finally {
					cleanupTunnelAndSession(tunnelProcess, sessionDir);
				}
			})();
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
		const { uuid, name, configPassword } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

	
		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		await setSshState(uuid, configPassword , 'on', sessionDir);
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
			`attachment; filename="backup_${name}.zip"`,
		);
		res.setHeader('Content-Type', 'application/zip');

		const fileStream = fs.createReadStream(zipFile);
		fileStream.pipe(res);

		fileStream.on('end', () => {
			fs.rmSync(downloadPath, { recursive: true, force: true });
			fs.unlinkSync(zipFile);

			(async () => {
				try {
					await setSshState(uuid, configPassword, 'off', sessionDir);
					console.log('SSH disabled after backup');
				} catch (err) {
					console.error('Failed to disable SSH after backup:', err.message || err);
				} finally {
					cleanupTunnelAndSession(tunnelProcess, sessionDir);
				}
			})();
		});
	} catch (error) {
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.error('Error during file download:', error);
		res
			.status(500)
			.json({ error: 'An error occurred while downloading files' });
	}
});

app.post('/upload-ionos', async (req, res) => {
	let tunnelProcess;
	let sessionDir;
	try {
		const { uuid, configPassword } = req.body;
		const token = req.headers.authorization.split('Bearer ')[1];
		jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

		sessionDir = await createSessionDir(uuid);
		await balenaLogin(token, sessionDir);
		await setSshState(uuid, configPassword , 'on', sessionDir);
		const { tunnelProcess: tp, tunnelPort } = await openTunnel(
			uuid,
			'12738:127.0.0.1',
			sessionDir,
		);
		tunnelProcess = tp;

		const command = `ssh -i /certs/tunnelKey/tunnelKey -p ${tunnelPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1 "/start-scripts/start-backup.sh backup"`;

		const output = await new Promise((resolve, reject) => {
			exec(command, (error, stdout, stderr) => {
				if (error) {
					console.error(`SSH error: ${error}`);
					reject(stderr || error.message);
				} else {
					console.log('Upload to Ionos command sent');
					resolve(stdout || stderr);
				}
			});
		});
		const lines = output.trim().split('\n');
		const lastLine = lines[lines.length - 1];
		res.json({
			success: true,
			message: 'Upload to Ionos command sent',
			output,
			lastLine,
		});

		(async () => {
			try {
				await setSshState(uuid, configPassword, 'off', sessionDir);
				console.log('SSH disabled after Ionos upload');
			} catch (err) {
				console.error('Failed to disable SSH after Ionos upload:', err.message || err);
			} finally {
				cleanupTunnelAndSession(tunnelProcess, sessionDir);
				console.log('Client disconnected');
			}
		})();
	} catch (error) {
		cleanupTunnelAndSession(tunnelProcess, sessionDir);
		console.error('Error during upload to Ionos:', error);
		res
			.status(500)
			.json({
				error: 'An error occurred while uploading to Ionos',
				details: error,
			});
	}
});
app.listen(PORT, HOST);
console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);
