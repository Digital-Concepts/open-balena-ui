import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, exec, ChildProcess } from 'node:child_process';
import multer from 'multer';
import portfinder from 'portfinder';
import waitPort from 'wait-port';
import serialize from 'serialize-javascript';
import jwt from 'njwt';
import registryImageRoutes from './routes/registryImage';
import serialListRoutes from './routes/serialList';
import housekeeperRoutes from './routes/housekeeper';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const CLIENT_DIR = 'dist/client';
const CLIENT_ENV_PLACEHOLDER = '<!--OBUI_RUNTIME_ENV-->';
const CLIENT_ENV_KEYS = [
  'REACT_APP_OPEN_BALENA_POSTGREST_URL',
  'REACT_APP_OPEN_BALENA_REMOTE_URL',
  'REACT_APP_OPEN_BALENA_API_URL',
  'REACT_APP_OPEN_BALENA_API_VERSION',
  'REACT_APP_BANNER_IMAGE',
  'REACT_APP_OPEN_BALENA_UI_URL',
];

const upload = multer({ dest: '/tmp/uploads/' });

const app = express();
// Required so express-rate-limit can read the real client IP from
// X-Forwarded-For when running behind nginx / balena ingress.
app.set('trust proxy', 1);
app.use(express.json());

app.use('/', registryImageRoutes);
app.use('/', serialListRoutes);
app.use('/', housekeeperRoutes);

// --- balena-cli session helpers (preserved from fork) -----------------------

interface TunnelHandle {
  tunnelProcess: ChildProcess;
  tunnelPort: number;
}

async function createSessionDir(uuid: string): Promise<string> {
  const sessionDir = `/tmp/sessions/${uuid}`;
  fs.mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

async function balenaLogin(token: string, sessionDir: string): Promise<void> {
  const loginCmd = `/usr/bin/balena login --token ${token} --unsupported`;
  return await new Promise<void>((resolve, reject) => {
    exec(loginCmd, { env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir } }, (error, stdout) => {
      if (error) {
        console.error('Login failed:', error.message);
        fs.rmSync(sessionDir, { recursive: true, force: true });
        reject(new Error('Failed to authenticate with Balena'));
      } else {
        console.log('Login successful:', stdout.toString());
        resolve();
      }
    });
  });
}

async function waitForPort(port: number): Promise<void> {
  const portOpen = await waitPort({ host: '127.0.0.1', port, timeout: 20000 });
  if (!portOpen) throw new Error('Failed to open tunnel');
}

async function openTunnel(uuid: string, portMap: string, sessionDir: string): Promise<TunnelHandle> {
  const tunnelPort = await portfinder.getPortPromise({ port: 20000, stopPort: 29999 });
  const tunnelCmd = `/usr/bin/balena device tunnel ${uuid} -p ${portMap}:${tunnelPort} --unsupported`;
  const tunnelProcess = spawn(tunnelCmd, {
    shell: true,
    env: { ...process.env, BALENARC_DATA_DIRECTORY: sessionDir },
  });
  tunnelProcess.stdout?.on('data', (data) => console.log(`Tunnel stdout: ${data}`));
  tunnelProcess.stderr?.on('data', (data) => console.error(`Tunnel stderr: ${data}`));
  await waitForPort(tunnelPort);
  return { tunnelProcess, tunnelPort };
}

function cleanupTunnel(tunnelProcess?: ChildProcess): void {
  if (tunnelProcess?.pid) {
    try {
      process.kill(tunnelProcess.pid);
    } catch (error) {
      console.error('Error killing tunnel process:', error);
    }
  }
}

function cleanupTunnelAndSession(tunnelProcess?: ChildProcess, sessionDir?: string): void {
  cleanupTunnel(tunnelProcess);
  if (sessionDir) fs.rmSync(sessionDir, { recursive: true, force: true });
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Fixed Basic header for the device config API. A header must be present or the
// request is rejected with 401; the credential value itself is not validated.
const TRUSTED_LOCAL_AUTH = `Basic ${Buffer.from('ConfigUser:local').toString('base64')}`;

async function setSshState(uuid: string, state: 'on' | 'off', sessionDir: string): Promise<any> {
  let tunnelProcess: ChildProcess | undefined;
  try {
    const handle = await openTunnel(uuid, '8099:127.0.0.1', sessionDir);
    tunnelProcess = handle.tunnelProcess;
    const sshResponse = await fetch(`http://127.0.0.1:${handle.tunnelPort}/system/config/ssh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: TRUSTED_LOCAL_AUTH,
      },
      body: JSON.stringify({ state }),
    });
    if (!sshResponse.ok) {
      const message = `Failed to change SSH status: ${sshResponse.statusText}`;
      console.error(message);
      throw new HttpError(message, sshResponse.status);
    }
    return await sshResponse.json();
  } finally {
    cleanupTunnel(tunnelProcess);
  }
}

function extractToken(req: Request): string {
  const auth = req.headers.authorization || '';
  return auth.split('Bearer ')[1] || '';
}

// --- Endpoints (preserved from fork) ----------------------------------------

app.post('/download-logs', async (req: Request, res: Response) => {
  let tunnelProcess: ChildProcess | undefined;
  let sessionDir: string | undefined;
  try {
    const { uuid, name } = req.body;
    const token = extractToken(req);
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET as string);
    sessionDir = await createSessionDir(uuid);
    await balenaLogin(token, sessionDir);
    await setSshState(uuid, 'on', sessionDir);
    const handle = await openTunnel(uuid, '12738:127.0.0.1', sessionDir);
    tunnelProcess = handle.tunnelProcess;
    res.setHeader('Content-Disposition', `attachment; filename="logs_${name}.tar.gz"`);
    res.setHeader('Content-Type', 'application/gzip');
    // Compress on the device and stream the archive out: only the gzipped
    // bytes cross the tunnel, not the raw log files.
    const child = spawn('ssh', [
      '-i', '/certs/tunnelKey/tunnelKey',
      '-p', String(handle.tunnelPort),
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      'root@127.0.0.1', 'tar czf - -C /var/log/dcgw .',
    ]);
    child.stdout.pipe(res);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0) console.error(`log archive failed (exit ${code}): ${stderr}`);
      void (async () => {
        try {
          await setSshState(uuid, 'off', sessionDir!);
        } catch (err: any) {
          console.error('Failed to disable SSH after logs:', err?.message || err);
        } finally {
          cleanupTunnelAndSession(tunnelProcess, sessionDir);
        }
      })();
    });
    // If the client aborts mid-download, stop the remote tar.
    res.on('close', () => { if (child.exitCode === null) child.kill(); });
  } catch (error) {
    cleanupTunnelAndSession(tunnelProcess, sessionDir);
    console.error('Error during log download', error);
    res.status(500).json({ error: 'An error occurred while downloading logs' });
  }
});

app.post('/log-level', async (req: Request, res: Response) => {
  let tunnelProcess: ChildProcess | undefined;
  let sessionDir: string | undefined;
  try {
    const { uuid, logLevels } = req.body;
    const token = extractToken(req);
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET as string);
    sessionDir = await createSessionDir(uuid);
    await balenaLogin(token, sessionDir);
    const handle = await openTunnel(uuid, '8099:127.0.0.1', sessionDir);
    tunnelProcess = handle.tunnelProcess;
    const logResponse = await fetch(`http://127.0.0.1:${handle.tunnelPort}/system/config/loglevel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: TRUSTED_LOCAL_AUTH,
      },
      body: JSON.stringify({ logLevel: logLevels }),
    });
    if (!logResponse.ok) {
      cleanupTunnelAndSession(tunnelProcess, sessionDir);
      return res.status(logResponse.status).json({ error: `Failed to update log level: ${logResponse.statusText}` });
    }
    const responseData = await logResponse.json();
    res.json({ success: true, data: responseData });
    cleanupTunnelAndSession(tunnelProcess, sessionDir);
  } catch (error: any) {
    cleanupTunnelAndSession(tunnelProcess, sessionDir);
    res.status(500).json({ error: 'An error occurred while changing log level' });
  }
});

app.post('/control-ssh', async (req: Request, res: Response) => {
  let sessionDir: string | undefined;
  try {
    const { uuid, status } = req.body;
    const token = extractToken(req);
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET as string);
    sessionDir = await createSessionDir(uuid);
    await balenaLogin(token, sessionDir);
    const responseData = await setSshState(uuid, status, sessionDir);
    res.json({ success: true, data: responseData });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    res.status(status).json({
      error: error instanceof HttpError ? error.message : 'An error occurred while changing SSH status',
    });
  }
});

app.post('/send-files', upload.array('files'), async (req: Request, res: Response) => {
  let tunnelProcess: ChildProcess | undefined;
  let sessionDir: string | undefined;
  try {
    const { uuid } = req.body;
    const token = extractToken(req);
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET as string);
    sessionDir = await createSessionDir(uuid);
    await balenaLogin(token, sessionDir);
    await setSshState(uuid, 'on', sessionDir);
    const handle = await openTunnel(uuid, '12738:127.0.0.1', sessionDir);
    tunnelProcess = handle.tunnelProcess;
    const files = (req.files as Express.Multer.File[]) || [];
    for (const file of files) {
      const scpCommand = `scp -i /certs/tunnelKey/tunnelKey -P ${handle.tunnelPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${file.path} root@127.0.0.1:/opt/spaceport/${file.originalname}`;
      await new Promise<void>((resolve, reject) => {
        exec(scpCommand, (error) => {
          if (error) reject(error);
          else resolve();
          fs.unlinkSync(file.path);
        });
      });
    }
    res.json({ success: true, message: 'Files uploaded successfully' });
    void (async () => {
      try {
        await setSshState(uuid, 'off', sessionDir!);
      } catch (err: any) {
        console.error('Failed to disable SSH after upload:', err?.message || err);
      } finally {
        cleanupTunnelAndSession(tunnelProcess, sessionDir);
      }
    })();
  } catch (error: any) {
    cleanupTunnelAndSession(tunnelProcess, sessionDir);
    res.status(500).json({ error: `An error occurred while transferring files: ${error?.message}` });
  }
});

app.post('/download-files', async (req: Request, res: Response) => {
  let tunnelProcess: ChildProcess | undefined;
  let sessionDir: string | undefined;
  try {
    const { uuid, name } = req.body;
    const token = extractToken(req);
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET as string);
    sessionDir = await createSessionDir(uuid);
    await balenaLogin(token, sessionDir);
    await setSshState(uuid, 'on', sessionDir);
    const handle = await openTunnel(uuid, '12738:127.0.0.1', sessionDir);
    tunnelProcess = handle.tunnelProcess;
    const downloadPath = `/tmp/sessions/${uuid}/download_${Date.now()}`;
    fs.mkdirSync(downloadPath, { recursive: true });
    const scpCommand = `scp -i /certs/tunnelKey/tunnelKey -P ${handle.tunnelPort} -r -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1:/opt/spaceport/outbound/* ${downloadPath}/`;
    await new Promise<void>((resolve, reject) => {
      exec(scpCommand, (error) => (error ? reject(error) : resolve()));
    });
    const zipFile = `/tmp/sessions/${uuid}/outbound_${Date.now()}.zip`;
    await new Promise<void>((resolve, reject) => {
      exec(`cd ${downloadPath} && zip -r ${zipFile} .`, (error) => (error ? reject(error) : resolve()));
    });
    res.setHeader('Content-Disposition', `attachment; filename="outbound_${name}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    const fileStream = fs.createReadStream(zipFile);
    fileStream.pipe(res);
    fileStream.on('end', () => {
      fs.rmSync(downloadPath, { recursive: true, force: true });
      fs.unlinkSync(zipFile);
      void (async () => {
        try {
          await setSshState(uuid, 'off', sessionDir!);
        } catch (err: any) {
          console.error('Failed to disable SSH after download:', err?.message || err);
        } finally {
          cleanupTunnelAndSession(tunnelProcess, sessionDir);
        }
      })();
    });
  } catch (error) {
    cleanupTunnelAndSession(tunnelProcess, sessionDir);
    res.status(500).json({ error: 'An error occurred while downloading files' });
  }
});

app.post('/update-supervisor', async (req: Request, res: Response) => {
  let tunnelProcess: ChildProcess | undefined;
  let sessionDir: string | undefined;
  try {
    const { uuid } = req.body;
    const token = extractToken(req);
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET as string);
    sessionDir = await createSessionDir(uuid);
    await balenaLogin(token, sessionDir);
    const handle = await openTunnel(uuid, '22222:127.0.0.1', sessionDir);
    tunnelProcess = handle.tunnelProcess;
    const command = `ssh -i /certs/tunnelKey/tunnelKey -p ${handle.tunnelPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1 "/usr/bin/update-balena-supervisor"`;
    const output = await new Promise<string>((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) reject(stderr || error.message);
        else resolve(stdout || stderr);
      });
    });
    cleanupTunnelAndSession(tunnelProcess, sessionDir);
    const lines = output.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    res.json({ success: true, message: 'Update supervisor command sent', output, lastLine });
  } catch (error) {
    cleanupTunnelAndSession(tunnelProcess, sessionDir);
    res.status(500).json({ error: 'An error occurred while updating Supervisor', details: error });
  }
});

app.post('/download-backup', async (req: Request, res: Response) => {
  let tunnelProcess: ChildProcess | undefined;
  let sessionDir: string | undefined;
  try {
    const { uuid, name } = req.body;
    const token = extractToken(req);
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET as string);
    sessionDir = await createSessionDir(uuid);
    await balenaLogin(token, sessionDir);
    await setSshState(uuid, 'on', sessionDir);
    const handle = await openTunnel(uuid, '12738:127.0.0.1', sessionDir);
    tunnelProcess = handle.tunnelProcess;
    const downloadPath = `/tmp/sessions/${uuid}/download_${Date.now()}`;
    fs.mkdirSync(downloadPath, { recursive: true });
    const scpCommand = `scp -i /certs/tunnelKey/tunnelKey -P ${handle.tunnelPort} -r -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1:/backup/backup_* ${downloadPath}/`;
    await new Promise<void>((resolve, reject) => {
      exec(scpCommand, (error) => (error ? reject(error) : resolve()));
    });
    const zipFile = `/tmp/sessions/${uuid}/backup_${Date.now()}.zip`;
    await new Promise<void>((resolve, reject) => {
      exec(`cd ${downloadPath} && zip -r ${zipFile} .`, (error) => (error ? reject(error) : resolve()));
    });
    res.setHeader('Content-Disposition', `attachment; filename="backup_${name}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    const fileStream = fs.createReadStream(zipFile);
    fileStream.pipe(res);
    fileStream.on('end', () => {
      fs.rmSync(downloadPath, { recursive: true, force: true });
      fs.unlinkSync(zipFile);
      void (async () => {
        try {
          await setSshState(uuid, 'off', sessionDir!);
        } catch (err: any) {
          console.error('Failed to disable SSH after backup:', err?.message || err);
        } finally {
          cleanupTunnelAndSession(tunnelProcess, sessionDir);
        }
      })();
    });
  } catch (error) {
    cleanupTunnelAndSession(tunnelProcess, sessionDir);
    res.status(500).json({ error: 'An error occurred while downloading files' });
  }
});

app.post('/upload-ionos', async (req: Request, res: Response) => {
  let tunnelProcess: ChildProcess | undefined;
  let sessionDir: string | undefined;
  try {
    const { uuid } = req.body;
    const token = extractToken(req);
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET as string);
    sessionDir = await createSessionDir(uuid);
    await balenaLogin(token, sessionDir);
    await setSshState(uuid, 'on', sessionDir);
    const handle = await openTunnel(uuid, '12738:127.0.0.1', sessionDir);
    tunnelProcess = handle.tunnelProcess;
    const command = `ssh -i /certs/tunnelKey/tunnelKey -p ${handle.tunnelPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1 "/start-scripts/start-backup.sh backup"`;
    const output = await new Promise<string>((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) reject(stderr || error.message);
        else resolve(stdout || stderr);
      });
    });
    const lines = output.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    res.json({ success: true, message: 'Upload to Ionos command sent', output, lastLine });
    void (async () => {
      try {
        await setSshState(uuid, 'off', sessionDir!);
      } catch (err: any) {
        console.error('Failed to disable SSH after Ionos upload:', err?.message || err);
      } finally {
        cleanupTunnelAndSession(tunnelProcess, sessionDir);
      }
    })();
  } catch (error) {
    cleanupTunnelAndSession(tunnelProcess, sessionDir);
    res.status(500).json({ error: 'An error occurred while uploading to Ionos', details: error });
  }
});

// --- Static + runtime env injection (from upstream) -------------------------

app.use(express.static(CLIENT_DIR, { index: false }));
app.get(/.*/, (_req, res) => {
  const indexPath = path.join(process.cwd(), CLIENT_DIR, 'index.html');

  if (!existsSync(indexPath)) {
    res.status(404).send('Client build not found');
    return;
  }

  const rawHtml = readFileSync(indexPath, 'utf-8');
  if (!rawHtml.includes(CLIENT_ENV_PLACEHOLDER)) {
    res.type('text/html').send(rawHtml);
    return;
  }

  const clientEnv = CLIENT_ENV_KEYS.reduce<Record<string, string>>((acc, key) => {
    const value = process.env[key];
    if (typeof value === 'string') {
      acc[key] = value;
    }
    return acc;
  }, {});

  const serializedEnv = serialize(clientEnv, { isJSON: true });
  const injection = `<script>window.__OBUI_ENV__ = Object.freeze(${serializedEnv});</script>`;
  res.type('text/html').send(rawHtml.replace(CLIENT_ENV_PLACEHOLDER, injection));
});

app.listen(PORT, HOST, () => {
  console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);
});
