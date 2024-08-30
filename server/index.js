const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const webpack = require('webpack');
const { createFsFromVolume, Volume } = require('memfs');
const webpackDevMiddleware = require('webpack-dev-middleware');
const webpackConfig = require('../webpack.config.js');
const Minio = require('minio');
const jwt = require('njwt');
require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const portfinder = require('portfinder');
const waitPort = require('wait-port');
const { spawn, execSync } = require('child_process');


const minioClient = new Minio.Client({
  endPoint: process.env.OPEN_BALENA_S3_URL.split('://')[1],
  useSSL: process.env.OPEN_BALENA_S3_URL.includes('https') ? true : false,
  accessKey: process.env.OPEN_BALENA_S3_ACCESS_KEY,
  secretKey: process.env.OPEN_BALENA_S3_SECRET_KEY,
});
const registryBucket = 'registry-data';

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const app = express();

app.use(bodyParser.json());

app.post('/deleteRegistryImage', async (req, res) => {
  try {
    jwt.verify(req.headers.authorization.split('Bearer ')[1], process.env.OPEN_BALENA_JWT_SECRET);
  } catch (err) {
    res.json({ success: false, message: 'Invalid token' });
    return;
  }
  const imageRepository = `data/docker/registry/v2/repositories/v2/${req.body.imageLocationHash}`;
  var objectsList = [];
  var objectsStream = minioClient.listObjects(registryBucket, imageRepository, true);
  objectsStream.on('data', (obj) => {
    objectsList.push(obj.name);
  });
  objectsStream.on('error', (err) => {
    res.json({ success: false, message: err });
    return;
  });
  objectsStream.on('end', () => {
    if (objectsList.length === 0) {
      res.json({ success: false, message: 'image not found' });
      return;
    }
    minioClient.removeObjects(registryBucket, objectsList, (err) => {
      if (err) {
        res.json({ success: false, message: err });
        return;
      }
      res.json({ success: true });
    });
  });
});

app.post('/deleteOrphanedRegistryImages', async (req, res) => {
  try {
    jwt.verify(req.headers.authorization.split('Bearer ')[1], process.env.OPEN_BALENA_JWT_SECRET);
  } catch (err) {
    res.json({ success: false, message: 'Invalid token' });
    return;
  }
  const databaseImages = req.body.databaseImages;
  const imageRepositories = `data/docker/registry/v2/repositories/v2/`;
  const registryImages = [];
  var objectsStream = minioClient.listObjects(registryBucket, imageRepositories, false);
  objectsStream.on('data', (obj) => {
    registryImages.push(obj.prefix.split('repositories/v2/')[1].split('/')[0]);
  });
  objectsStream.on('error', (err) => {
    res.json({ success: false, message: err });
    return;
  });
  objectsStream.on('end', () => {
    const orphanedImages = registryImages.filter((x) => !databaseImages.includes(x));
    const imagesToDelete = databaseImages.filter((x) => !registryImages.includes(x));
    res.json({ success: true, orphanedImages, imagesToDelete });
    /*
    minioClient.removeObjects(registryBucket, objectsList, (err) => {
      if (err) {
        res.json({success: false, message: err});
        return;
      } 
      res.json({success: true});
    });
    */
  });
});

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
    const tunnelCmd = `/usr/bin/balena tunnel ${uuid} -p 8080:127.0.0.1:${tunnelPort} --unsupported`;

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
      tunnelProcess.kill('SIGINT');
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Failed to open tunnel' });
    }

    const logResponse = await fetch(`http://127.0.0.1:${tunnelPort}/system/logfiles`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`,
      },
    });

    if (!logResponse.ok) {
      tunnelProcess.kill('SIGINT');  
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.status(logResponse.status).json({ error: 'Failed to fetch logs' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="logs_${password}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    logResponse.body.pipe(res);

    logResponse.body.on('end', () => {
      console.log('Logs download complete, closing tunnel...');
      if (tunnelProcess) {
        tunnelProcess.kill('SIGINT');
        tunnelProcess.on('close', (code) => {
          console.log(`Tunnel process exited with code ${code}`);
        });
      }
      fs.rmSync(sessionDir, { recursive: true, force: true });
    });

  } catch (error) {
    if (tunnelProcess) {
      console.log('Error occurred, closing tunnel...');
      tunnelProcess.kill('SIGINT');  
    }
    console.error('Error during log download', error);
    res.status(500).json({ error: 'An error occurred while downloading logs' });
  } finally {

    if (tunnelProcess) {
      tunnelProcess.kill('SIGINT');  
      tunnelProcess.on('close', (code) => {
        console.log(`Tunnel process exited with code ${code}`);
      });
    }
  }
});

app.post('/log-level', async (req, res) => {
  let tunnelProcess; 
  try {
    const { uuid, password, logLevels } = req.body;
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
    const tunnelCmd = `/usr/bin/balena tunnel ${uuid} -p 8099:127.0.0.1:${tunnelPort} --unsupported`;

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
      tunnelProcess.kill('SIGINT');
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Failed to open tunnel' });
    }

    const logResponse = await fetch(`http://127.0.0.1:${tunnelPort}/system/config/loglevel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`ConfigUser:${password}`).toString('base64')}`,
      },
       body: JSON.stringify({
      logLevel: logLevels,  // Include the logLevel in the request body
     }),
    });

    if (!logResponse.ok) {
      console.error('Failed to update log level', logResponse.statusText);
      return res.status(logResponse.status).json({ error: 'Failed to update log level' });
    }

    const responseData = await logResponse.json();  // Assuming the response is in JSON format
    res.json({ success: true, data: responseData });

  } catch (error) {
    console.error('Error during log level change:', error.message);
    res.status(500).json({ error: 'An error occurred while changing log level' });
  } finally {
    if (tunnelProcess) {
      tunnelProcess.kill('SIGINT');
      tunnelProcess.on('close', (code) => {
        console.log(`Tunnel process exited with code ${code}`);
      });
    }
    fs.rmSync(`/tmp/sessions/${req.body.uuid}`, { recursive: true, force: true });
  }
});


process.on('exit', () => {
  if (tunnelProcess) {
    tunnelProcess.kill('SIGINT');
  }
});


// React client endpoints
const memfs = createFsFromVolume(new Volume());
memfs.join = path.join.bind(path);

const compiler = webpack(webpackConfig);

app.use(
  webpackDevMiddleware(compiler, {
    publicPath: webpackConfig.output.publicPath,
    stats: 'errors-only',
    outputFileSystem: memfs,
  }),
);

app.get('*', async (req, res) => {
  try {
    res.send(memfs.readFileSync(path.join(compiler.outputPath, 'index.html')).toString());
  } catch (error) {
    res.sendStatus(404);
  }
});

app.listen(PORT, HOST);
console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);
