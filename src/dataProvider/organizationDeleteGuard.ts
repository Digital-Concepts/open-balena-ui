import type { DataProvider, Identifier } from 'react-admin';

const MAX_NAMES = 10;
const PAGE = { page: 1, perPage: 1000 };
const BY_ID = { field: 'id', order: 'ASC' as const };

const list = (names: string[]): string =>
  names.length <= MAX_NAMES
    ? names.join(', ')
    : `${names.slice(0, MAX_NAMES).join(', ')} and ${names.length - MAX_NAMES} more`;

const blockerMessage = (orgName: string, fleets: string[], members: string[]): string => {
  const parts: string[] = [];
  if (fleets.length) parts.push(`it still owns fleets ${list(fleets)}`);
  if (members.length) parts.push(`${fleets.length ? '' : 'it still '}has members ${list(members)}`);
  const todo = [fleets.length ? 'Move the fleets to another org' : '', members.length ? (fleets.length ? 'remove the members' : 'Remove the members') : '']
    .filter(Boolean)
    .join(' and ');
  return `Cannot delete "${orgName}": ${parts.join(' and ')}. ${todo} first.`;
};

const FK_MESSAGE = /still referenced from table "([^"]+)"/;

// Maps PostgREST FK violations (23503) to a readable error; other errors pass through.
export const mapForeignKeyError = (err: unknown): unknown => {
  const body = (err as { body?: { code?: string; details?: string } } | null)?.body;
  if (body?.code !== '23503') return err;
  const table = body.details?.match(FK_MESSAGE)?.[1];
  return new Error(
    `Cannot delete: still referenced by ${table ?? 'other records'}; remove those first.`,
  );
};

// Admin-only guard: refuses organization deletes while fleets or members remain.
export function organizationDeleteGuard(inner: DataProvider): DataProvider {
  const findBlockers = async (ids: Identifier[]): Promise<string[]> => {
    const messages: string[] = [];
    for (const id of ids) {
      const [org, fleets, memberships] = await Promise.all([
        inner.getOne('organization', { id }).catch(() => null),
        inner.getList('application', { pagination: PAGE, sort: BY_ID, filter: { organization: id } }),
        inner.getList('organization membership', {
          pagination: PAGE,
          sort: BY_ID,
          filter: { 'is member of-organization': id },
        }),
      ]);
      const userIds = [...new Set(memberships.data.map((m) => m['user'] as Identifier))];
      let members: string[] = [];
      if (userIds.length) {
        const users = await inner.getMany('user', { ids: userIds });
        const byId = new Map(users.data.map((u) => [String(u.id), String(u['username'] ?? u.id)]));
        members = userIds.map((u) => byId.get(String(u)) ?? String(u));
      }
      const fleetNames = fleets.data.map((f) => String(f['app name'] ?? f.id));
      if (fleetNames.length || members.length) {
        messages.push(blockerMessage(String(org?.data?.name ?? id), fleetNames, members));
      }
    }
    return messages;
  };

  const guarded = async (ids: Identifier[], run: () => Promise<any>) => {
    const messages = await findBlockers(ids);
    if (messages.length) throw new Error(messages.join(' '));
    try {
      return await run();
    } catch (err) {
      throw mapForeignKeyError(err);
    }
  };

  return {
    ...inner,
    delete: (resource: string, params: any) =>
      resource === 'organization' ? guarded([params.id], () => inner.delete(resource, params)) : inner.delete(resource, params),
    deleteMany: (resource: string, params: any) =>
      resource === 'organization'
        ? guarded(params.ids, () => inner.deleteMany(resource, params))
        : inner.deleteMany(resource, params),
  } as DataProvider;
}
