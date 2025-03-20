const express = require('express');
const registryImageRoutes = require('./routes/registryImage');
const { getReactAppEnv } = require('./controller/appEnvironment');

const jwt = require('njwt');
require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
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
app.get('/environment.js', getReactAppEnv);
app.get('*', express.static('dist'));

const cleanupTunnel = (tunnelProcess, sessionDir) => {
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
};

app.post('/download-logs', async (req, res) => {
  let tunnelProcess; 
  try {
    const { uuid, password } = req.body;
    const token = req.headers.authorization.split('Bearer ')[1];
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

    const sessionDir = `/tmp/sessions/${uuid}`;
    fs.mkdirSync(sessionDir, { recursive: true });

    const loginCmd = `/usr/bin/balena login --token ${token} --unsupported`;
    try {
      const loginResult = execSync(loginCmd, { env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir } });
      console.log('Login successful:', loginResult.toString());
    } catch (error) {
      console.error('Login failed:', error.message);
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Failed to authenticate with Balena' });
    }

    const tunnelPort = await portfinder.getPortPromise({ port: 20000, stopPort: 29999 });
    const tunnelCmd = `/usr/bin/balena device tunnel ${uuid} -p 8080:127.0.0.1:${tunnelPort} --unsupported`;

    tunnelProcess = spawn(tunnelCmd, {
      shell: true,
      env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir },
    });

    tunnelProcess.stdout.on('data', (data) => {
      console.log(`Tunnel stdout: ${data}`);
    });

    tunnelProcess.stderr.on('data', (data) => {
      console.error(`Tunnel stderr: ${data}`);
    });

    // Add error handler for tunnel process
    tunnelProcess.on('error', (error) => {
      console.error('Tunnel process error:', error);
      cleanupTunnel(tunnelProcess, sessionDir);
    });

    const portOpen = await waitPort({ host: '127.0.0.1', port: tunnelPort, timeout: 20000 });
    if (!portOpen) {
      console.log('Failed to open tunnel.');
      cleanupTunnel(tunnelProcess, sessionDir);
      return res.status(500).json({ error: 'Failed to open tunnel' });
    }

    const logResponse = await fetch(`http://127.0.0.1:${tunnelPort}/system/logfiles`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`,
      },
    });

    if (!logResponse.ok) {
      cleanupTunnel(tunnelProcess, sessionDir);
      return res.status(logResponse.status).json({ error: 'Failed to fetch logs' });
    }

    logResponse.body.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming logs' });
      }
      cleanupTunnel(tunnelProcess, sessionDir);
    });

    res.on('close', () => {
      // Handle client disconnect
      console.log('Client disconnected');
      cleanupTunnel(tunnelProcess, sessionDir);
    });

    res.setHeader('Content-Disposition', `attachment; filename="logs_${password}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    logResponse.body.pipe(res);

  } catch (error) {
    cleanupTunnel(tunnelProcess, sessionDir);
    console.error('Error during log download', error);
    res.status(500).json({ error: 'An error occurred while downloading logs' });
  }
});

app.post('/log-level', async (req, res) => {
  let tunnelProcess; 
  const sessionDir = `/tmp/sessions/${req.body.uuid}`;
  try {
    const { uuid, password, logLevels } = req.body;
    const token = req.headers.authorization.split('Bearer ')[1];
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

    fs.mkdirSync(sessionDir, { recursive: true });

    const loginCmd = `/usr/bin/balena login --token ${token} --unsupported`;
    try {
      const loginResult = execSync(loginCmd, { env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir } });
      console.log('Login successful:', loginResult.toString());
    } catch (error) {
      console.error('Login failed:', error.message);
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Failed to authenticate with Balena' });
    }

    const tunnelPort = await portfinder.getPortPromise({ port: 20000, stopPort: 29999 });
    const tunnelCmd = `/usr/bin/balena device tunnel ${uuid} -p 8099:127.0.0.1:${tunnelPort} --unsupported`;

    tunnelProcess = spawn(tunnelCmd, {
      shell: true,
      env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir },
    });

    tunnelProcess.stdout.on('data', (data) => {
      console.log(`Tunnel stdout: ${data}`);
    });

    tunnelProcess.stderr.on('data', (data) => {
      console.error(`Tunnel stderr: ${data}`);
    });

    //res.on('close', () => {
    // cleanupTunnel(tunnelProcess, sessionDir);
    //  console.log('Client disconnected');  
    //});

    const portOpen = await waitPort({ host: '127.0.0.1', port: tunnelPort, timeout: 20000 });
    if (!portOpen) {
      console.log('Failed to open tunnel.');
      cleanupTunnel(tunnelProcess, sessionDir);
      return res.status(500).json({ error: 'Failed to open tunnel' });
    }

    const logResponse = await fetch(`http://127.0.0.1:${tunnelPort}/system/config/loglevel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`ConfigUser:${password}`).toString('base64')}`,
      },
      body: JSON.stringify({ logLevel: logLevels }),
    });

    if (!logResponse.ok) {
      cleanupTunnel(tunnelProcess, sessionDir);
      console.error('Failed to update log level:', logResponse.statusText);
      return res.status(logResponse.status).json({ error: `Failed to update log level: ${logResponse.statusText}` });
    }

    const responseData = await logResponse.json();
    res.json({ success: true, data: responseData });
    
    // Clean up after successful response
     cleanupTunnel(tunnelProcess, sessionDir);
     console.log('Client disconnected');
  } catch (error) {
    cleanupTunnel(tunnelProcess, sessionDir);
    console.error('Error during log level change:', error.message);
    res.status(500).json({ error: 'An error occurred while changing log level' });
  }
});

app.post('/send-files', upload.array('files'), async (req, res) => {
  let tunnelProcess; 
  const sessionDir = `/tmp/sessions/${req.body.uuid}`;
  try {
    const { uuid, password } = req.body;
    const token = req.headers.authorization.split('Bearer ')[1];
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

    fs.mkdirSync(sessionDir, { recursive: true });

    const loginCmd = `/usr/bin/balena login --token ${token} --unsupported`;
    try {
      const loginResult = execSync(loginCmd, { env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir } });
      console.log('Login successful:', loginResult.toString());
    } catch (error) {
      console.error('Login failed:', error.message);
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Failed to authenticate with Balena' });
    }

    const tunnelPort = await portfinder.getPortPromise({ port: 20000, stopPort: 29999 });
    const tunnelCmd = `/usr/bin/balena device tunnel ${uuid} -p 12738:127.0.0.1:${tunnelPort} --unsupported`;

    tunnelProcess = spawn(tunnelCmd, {
      shell: true,
      env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir },
    });

    tunnelProcess.stdout.on('data', (data) => {
      console.log(`Tunnel stdout: ${data}`);
    });

    tunnelProcess.stderr.on('data', (data) => {
      console.error(`Tunnel stderr: ${data}`);
    });

    const portOpen = await waitPort({ host: '127.0.0.1', port: tunnelPort, timeout: 20000 });
    if (!portOpen) {
      console.log('Failed to open tunnel.');
      cleanupTunnel(tunnelProcess, sessionDir);
      return res.status(500).json({ error: 'Failed to open tunnel' });
    }
    for (const file of req.files) {
      // We are going to use scp to transfer the file through the tunnel.
      const scpCommand = `sshpass -p "${password}" scp -P ${tunnelPort} -o StrictHostKeyChecking=no  -o UserKnownHostsFile=/dev/null ${file.path} root@127.0.0.1:/opt/spaceport/${file.originalname}`;
      
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

    cleanupTunnel(tunnelProcess, sessionDir);
    console.log('Client disconnected');
    res.json({ success: true, message: 'Files uploaded successfully' });

  } catch (error) {
    cleanupTunnel(tunnelProcess, sessionDir);
    console.error('Error during file transfer:', error.message);
    res.status(500).json({ error: 'An error occurred while transferring files' });
  }
});

app.post('/download-files', async (req, res) => {
  let tunnelProcess; 
  const sessionDir = `/tmp/sessions/${req.body.uuid}`;
  try {
    const { uuid, password } = req.body;
    const token = req.headers.authorization.split('Bearer ')[1];
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);

    const sessionDir = `/tmp/sessions/${uuid}`;
    fs.mkdirSync(sessionDir, { recursive: true });

    const loginCmd = `/usr/bin/balena login --token ${token} --unsupported`;
    try {
      const loginResult = execSync(loginCmd, { env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir } });
      console.log('Login successful:', loginResult.toString());
    } catch (error) {
      console.error('Login failed:', error.message);
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Failed to authenticate with Balena' });
    }

    const tunnelPort = await portfinder.getPortPromise({ port: 20000, stopPort: 29999 });
    const tunnelCmd = `/usr/bin/balena device tunnel ${uuid} -p 12738:127.0.0.1:${tunnelPort} --unsupported`;

    tunnelProcess = spawn(tunnelCmd, {
      shell: true,
      env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir },
    });

    tunnelProcess.stdout.on('data', (data) => {
      console.log(`Tunnel stdout: ${data}`);
    });

    tunnelProcess.stderr.on('data', (data) => {
      console.error(`Tunnel stderr: ${data}`);
    });

    const portOpen = await waitPort({ host: '127.0.0.1', port: tunnelPort, timeout: 20000 });
    if (!portOpen) {
      console.log('Failed to open tunnel.');
      cleanupTunnel(tunnelProcess, sessionDir);
      return res.status(500).json({ error: 'Failed to open tunnel' });
    }

    const downloadPath = `/tmp/sessions/${uuid}/download_${Date.now()}`;
    fs.mkdirSync(downloadPath, { recursive: true });

    // Download the remote directory using scp
    const scpCommand = `sshpass -p "${password}" scp -P ${tunnelPort} -r -o StrictHostKeyChecking=no  -o UserKnownHostsFile=/dev/null root@127.0.0.1:/opt/spaceport/outbound/* ${downloadPath}/`;
    
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

    // Create zip file from downloaded content
    const zipFile = `/tmp/sessions/${uuid}/outbound_${Date.now()}.zip`;
    await new Promise((resolve, reject) => {
      exec(`cd ${downloadPath} && zip -r ${zipFile} .`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Zip error: ${error}`);
          reject(error);
        } else {
          resolve();
        }
      });
    });

    // Stream the zip file back to client
    res.setHeader('Content-Disposition', `attachment; filename="outbound_${password}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    
    const fileStream = fs.createReadStream(zipFile);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      // Cleanup after streaming is complete
      fs.rmSync(downloadPath, { recursive: true, force: true });
      fs.unlinkSync(zipFile);
      cleanupTunnel(tunnelProcess, sessionDir);
    });

  } catch (error) {
    cleanupTunnel(tunnelProcess, sessionDir);
    console.error('Error during file download:', error);
    res.status(500).json({ error: 'An error occurred while downloading files' });
  }
});

app.listen(PORT, HOST);
console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);
