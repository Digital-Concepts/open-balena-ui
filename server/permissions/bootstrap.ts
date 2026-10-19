import { CUSTOMER_STANDARD } from './capabilities';
import type { PermissionStore } from './store';

// Seeds the default sets and makes only the listed bootstrap admins admins, exactly once.
export async function bootstrapPermissions(
  store: PermissionStore,
  listUsers: () => Promise<{ id: number; username: string }[]>,
  bootstrapAdmins: string[],
): Promise<string[]> {
  if (store.isSeeded()) return [];
  if (bootstrapAdmins.length === 0) {
    throw new Error('ADMIN_UI_BOOTSTRAP_ADMINS is not set; refusing to seed');
  }
  const users = await listUsers();
  if (users.length === 0) {
    throw new Error('No openBalena users found; refusing to seed without an admin');
  }
  const matched = users.filter((u) => bootstrapAdmins.includes(u.username));
  if (matched.length === 0) {
    throw new Error('None of ADMIN_UI_BOOTSTRAP_ADMINS exist in openBalena; refusing to seed');
  }
  store.transaction(() => {
    const admin = store.createSet(
      { name: 'Admin', description: 'Full access to the admin UI', capabilities: ['admin'] },
      { builtin: true },
    );
    store.createSet({
      name: 'Customer Standard',
      description: 'Own fleets: view, logs, actions, terminal, tags, release pin',
      capabilities: CUSTOMER_STANDARD,
    });
    for (const u of matched) store.assignUser(u.id, admin.id);
    store.markSeeded();
  });
  return matched.map((u) => u.username);
}
