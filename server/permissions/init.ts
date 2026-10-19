import { odataGet, odataQuery, serviceKeyConfigured } from '../lib/balenaApi';
import { bootstrapPermissions } from './bootstrap';
import { openStore, setStore } from './store';

const RETRY_MS = 30_000;

export async function listOpenBalenaUsers(): Promise<{ id: number; username: string }[]> {
  return odataGet<{ id: number; username: string }>(odataQuery('user', { $select: 'id,username' }));
}

export async function listOpenBalenaUserIds(): Promise<number[]> {
  return (await listOpenBalenaUsers()).map((u) => u.id);
}

export async function initPermissions(): Promise<void> {
  const store = openStore(process.env.ADMIN_UI_DB_PATH || '/data/admin-ui.db');
  setStore(store);
  if (!serviceKeyConfigured()) {
    console.error('[permissions] OPEN_BALENA_SERVICE_API_KEY or API URL missing: customer API disabled');
  }
  const bootstrapAdmins = (process.env.ADMIN_UI_BOOTSTRAP_ADMINS ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const attempt = async (): Promise<void> => {
    try {
      const seeded = await bootstrapPermissions(store, listOpenBalenaUsers, bootstrapAdmins);
      console.log(seeded.length ? `[permissions] ready; seeded admins: ${seeded.join(', ')}` : '[permissions] ready');
    } catch (error) {
      console.error(`[permissions] first-run seeding failed, retrying in 30s: ${(error as Error).message}`);
      setTimeout(() => void attempt(), RETRY_MS);
    }
  };
  await attempt();
}
