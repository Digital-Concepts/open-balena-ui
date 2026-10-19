import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import serialize from 'serialize-javascript';
import registryImageRoutes from './routes/registryImage';
import serialListRoutes from './routes/serialList';
import housekeeperRoutes from './routes/housekeeper';
import securityRoutes from './routes/security';
import taskDispatcherRoutes from './routes/taskDispatcher';
import deviceAdminRoutes from './routes/deviceAdmin';
import meRoutes from './routes/me';
import customerRoutes from './customer/routes';
import customerDeviceActionRoutes from './customer/deviceActions';
import permissionRoutes from './permissions/routes';
import { initPermissions } from './permissions/init';
import { sweepTempDirs } from './lib/deviceShell';

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

const app = express();
// Required so express-rate-limit can read the real client IP from
// X-Forwarded-For when running behind nginx / balena ingress.
app.set('trust proxy', 1);
app.use(express.json());

app.use('/', meRoutes);
app.use('/', customerRoutes);
app.use('/', customerDeviceActionRoutes);
app.use('/', permissionRoutes);
app.use('/', registryImageRoutes);
app.use('/', serialListRoutes);
app.use('/', housekeeperRoutes);
app.use('/', securityRoutes);
app.use('/', taskDispatcherRoutes);
app.use('/', deviceAdminRoutes);

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

sweepTempDirs();

void initPermissions().finally(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);
  });
});
