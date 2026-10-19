import base32Encode from 'base32-encode';
import { hashSync } from 'bcrypt-ts';
import { useQueryClient } from '@tanstack/react-query';
import { DataProvider, useDataProvider, useNotify, useRedirect } from 'react-admin';
import { useDeleteApiKey, useGenerateApiKey } from './apiKey';
import { deleteAllRelated } from './delete';
import { AccountChoice, apiMessage, putAccount } from './adminApi';

const hashPassword = (password) => {
  const saltRounds = 10;
  return hashSync(password, saltRounds).replace('2a', '2b');
};

export function useCreateUser() {
  const dataProvider = useDataProvider();
  const generateApiKey = useGenerateApiKey();

  return async (data) => {
    const roles = await dataProvider.getList('role', {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    });
    // create user actor and user API key
    const userRole = roles.data.find((x) => x.name === 'named-user-api-key');
    const userActor = await dataProvider.create('actor', { data: {} });
    data.actor = userActor.data.id;
    const userApiKey = await dataProvider.create('api key', {
      data: { 'key': generateApiKey(), 'is of-actor': userActor.data.id },
    });
    await dataProvider.create('api key-has-role', { data: { 'api key': userApiKey.data.id, 'role': userRole.id } });
    // hash password and generate jwt secret
    data.password = hashPassword(data.password);
    const randomBytes = new Uint8Array(20);
    crypto.getRandomValues(randomBytes);
    data['jwt secret'] = base32Encode(randomBytes, 'RFC3548').toString();
    return data;
  };
}

export const DEFAULT_USER_ROLE = 'default-user';

// Grants the openBalena `default-user` role (required for /login_). Returns an error message or null.
export async function assignDefaultRole(
  dataProvider: Pick<DataProvider, 'getList' | 'create'>,
  userId: number | string,
): Promise<string | null> {
  const manual = `Add it manually under Access → Users → Roles.`;
  try {
    const roles = await dataProvider.getList('role', {
      pagination: { page: 1, perPage: 1 },
      sort: { field: 'id', order: 'ASC' },
      filter: { name: DEFAULT_USER_ROLE },
    });
    const role = roles.data.find((x) => x.name === DEFAULT_USER_ROLE);
    if (!role) return `User created, but role '${DEFAULT_USER_ROLE}' does not exist. ${manual}`;
    await dataProvider.create('user-has-role', { data: { user: userId, role: role.id } });
    return null;
  } catch {
    return `User created, but assigning role '${DEFAULT_USER_ROLE}' failed. ${manual}`;
  }
}

const NO_CHOICE: AccountChoice = { type: 'internal', orgId: '', permissionSetId: '' };

// Create-onSuccess handler: sets up the account type, then does react-admin's default notify + redirect.
// Customer: the server syncs membership + role. Internal: default role, then the optional permission set.
export function useUserCreated(getChoice?: () => AccountChoice) {
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const redirect = useRedirect();
  const queryClient = useQueryClient();

  return async (user: { id: number | string }) => {
    const choice = getChoice?.() ?? NO_CHOICE;
    const failed: string[] = [];
    if (choice.type === 'customer') {
      const r = await putAccount(user.id, choice);
      if (!r.ok) failed.push(`customer account (${apiMessage(r.body, 'unknown error')})`);
    } else {
      if (await assignDefaultRole(dataProvider, user.id)) failed.push(`role '${DEFAULT_USER_ROLE}'`);
      if (choice.permissionSetId !== '') {
        const r = await putAccount(user.id, choice);
        if (!r.ok) failed.push(`permission set (${apiMessage(r.body, 'unknown error')})`);
      }
    }
    const error = failed.length ? `User created, but not saved: ${failed.join('; ')}. Fix it on the user page.` : null;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['user-has-role'] }),
      queryClient.invalidateQueries({ queryKey: ['organization membership'] }),
    ]);
    if (error) notify(error, { type: 'error' });
    else notify('ra.notification.created', { type: 'info', messageArgs: { smart_count: 1 } });
    redirect('edit', 'user', user.id, user);
  };
}

export const MAPPING_FIELDS = ['organizationArray', 'roleArray', 'permissionArray'];

// Only internal accounts may write openBalena mappings from the user form; the server owns customers'.
export function guardMappings<T extends Record<string, any>>(accountType: string | null, data: T): T {
  if (accountType !== 'internal') MAPPING_FIELDS.forEach((f) => delete data[f]);
  return data;
}

export function useModifyUser() {
  const dataProvider = useDataProvider();
  const queryClient = useQueryClient();

  const modifyMappingTable = async (data, field, table, sourceField, destField) => {
    // Field never loaded/seeded: leave the mapping untouched rather than deleting everything.
    if (!Array.isArray(data[field])) return;
    let existingMappings = await dataProvider.getList(table, {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { [sourceField]: data.id },
    });
    let existingData = existingMappings.data.map((x) => x[destField]);
    let createData = data[field].filter((value) => !existingData.includes(value));
    let deleteIds = existingMappings.data.filter((value) => !data[field].includes(value[destField])).map((x) => x.id);
    await Promise.all(
      createData.map((newData) =>
        dataProvider.create(table, { data: { [sourceField]: data.id, [destField]: newData } }),
      ),
    );
    await Promise.all(deleteIds.map((deleteId) => dataProvider.delete(table, { id: deleteId })));
  };

  return async (data) => {
    const mappings = {
      roleMapping: { field: 'roleArray', table: 'user-has-role', sourceField: 'user', destField: 'role' },
      permissionMapping: {
        field: 'permissionArray',
        table: 'user-has-permission',
        sourceField: 'user',
        destField: 'permission',
      },
      organizationMapping: {
        field: 'organizationArray',
        table: 'organization membership',
        sourceField: 'user',
        destField: 'is member of-organization',
      },
    };
    await Promise.all(
      Object.keys(mappings).map((x) =>
        modifyMappingTable(data, mappings[x].field, mappings[x].table, mappings[x].sourceField, mappings[x].destField),
      ),
    );
    await Promise.all(
      Object.keys(mappings).map((x) => queryClient.invalidateQueries({ queryKey: [mappings[x].table] })),
    );
    Object.keys(mappings).forEach((x) => delete data[mappings[x].field]);
    return data;
  };
}

// openBalena's service API keys (VPN, API) belong to `guest`; deleting it cuts every device off the VPN.
export const PROTECTED_USERNAMES = ['guest'];

export const isProtectedUser = (user: { username?: unknown } | null | undefined): boolean =>
  typeof user?.username === 'string' && PROTECTED_USERNAMES.includes(user.username);

const protectedUserError = (username: string) =>
  new Error(`"${username}" is an openBalena system user and cannot be deleted`);

export function useDeleteUser() {
  const dataProvider = useDataProvider();
  const deleteApiKey = useDeleteApiKey();

  return async (user) => {
    if (isProtectedUser(user)) throw protectedUserError(user.username);
    let relatedIndirectLookups = [
      {
        remoteResource: 'api key',
        remoteField: 'is of-actor',
        viaRemoteField: 'id',
        viaResource: 'actor',
        viaLocalField: 'id',
        localField: 'actor',
        deleteFunction: deleteApiKey,
      },
    ];
    let relatedDirectLookups = [
      { remoteResource: 'user-has-permission', remoteField: 'user', localField: 'id' },
      { remoteResource: 'user-has-public key', remoteField: 'user', localField: 'id' },
      { remoteResource: 'user-has-role', remoteField: 'user', localField: 'id' },
      { remoteResource: 'organization membership', remoteField: 'user', localField: 'id' },
    ];
    await deleteAllRelated(dataProvider, user, relatedIndirectLookups, relatedDirectLookups);
    await dataProvider.delete('user', { id: user['id'] });
    await dataProvider.delete('actor', { id: user['actor'] });
    return Promise.resolve();
  };
}

export function useDeleteUserBulk() {
  const dataProvider = useDataProvider();
  const deleteUser = useDeleteUser();

  return async (userIds) => {
    const selectedUsers = await dataProvider.getMany('user', { ids: userIds });
    const blocked = selectedUsers.data.find(isProtectedUser);
    if (blocked) throw protectedUserError(blocked.username);
    return Promise.all(selectedUsers.data.map((user) => deleteUser(user)));
  };
}
