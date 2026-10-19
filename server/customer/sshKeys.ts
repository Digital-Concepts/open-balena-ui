import { postgrestAsAdmin } from '../lib/postgrestAsAdmin';
import { odataDeleteAs, odataGetAs, odataPostAs, odataQuery } from '../lib/balenaApi';

export const REMOTE_KEY_TITLE = 'open-balena-remote';

// Public keys can't be edited, so the user's previous remote key is deleted before the new one is stored.
// Runs with the user's own token: the service key is a single user's key and cannot manage other users' keys.
export async function replaceRemoteKey(userAuth: string, userId: number, publicKey: string): Promise<void> {
  const keys = await odataGetAs<{ id: number }>(
    userAuth,
    odataQuery('user__has__public_key', {
      $select: 'id',
      $filter: `user eq ${userId} and title eq '${REMOTE_KEY_TITLE}'`,
    }),
  );
  await Promise.all(keys.map((k) => odataDeleteAs(userAuth, `user__has__public_key(${k.id})`)));
  await odataPostAs(userAuth, 'user__has__public_key', { user: userId, title: REMOTE_KEY_TITLE, public_key: publicKey });
}

// Admin-side revocation through the PostgREST proxy, which only admits admins.
export async function revokeRemoteKeys(userId: number, adminAuth: string | undefined): Promise<void> {
  await postgrestAsAdmin(
    adminAuth,
    'DELETE',
    'user-has-public key',
    `user=eq.${encodeURIComponent(String(userId))}&title=eq.${encodeURIComponent(REMOTE_KEY_TITLE)}`,
  );
}
