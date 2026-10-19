import express from 'express';
import {
  APPLICATION_SELECT,
  DEVICE_SELECT,
  DEVICE_TYPE_SELECT,
  PINNED_RELEASE_FIELD,
  RELEASE_FULL_SELECT,
  RELEASE_SELECT,
} from '../lib/balenaFields';
import {
  apiGetJson,
  apiPost,
  odataCount,
  odataDelete,
  odataGet,
  odataPatch,
  odataPost,
  odataQuery,
  odataString,
  refId,
} from '../lib/balenaApi';
import { HttpError, wrap } from '../lib/httpError';
import dosProtect from '../middleware/dosProtect';
import { requireCapability } from '../middleware/permissions';
import { audited } from '../audit/record';
import { replaceRemoteKey } from './sshKeys';
import {
  CustomerService,
  toCustomerDevice,
  toCustomerLog,
  toCustomerRelease,
  toLookupApplication,
  toLookupDeviceType,
  toLookupRelease,
} from './mappers';
import {
  inScope,
  isDeviceUuid,
  loadDeviceByIdInScope,
  loadDeviceInScope,
  POSITIVE_INT_RE,
  RawDevice,
  scopeFilter,
  scopeFor,
} from './scope';

const router = express.Router();

const intParam = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback;
};

const DEVICE_SORTS: Record<string, string> = {
  'device name': 'device_name',
  'last connectivity event': 'last_connectivity_event',
  'api heartbeat state': 'api_heartbeat_state',
  'is running-release': 'is_running__release',
  'belongs to-application': 'belongs_to__application',
  id: 'id',
  name: 'device_name',
  lastSeen: 'last_connectivity_event',
  online: 'is_online',
};

// Same fields as the admin device search: name, note, ip address and status, case-insensitive.
const searchFilter = (lit: string) =>
  ['device_name', 'note', 'ip_address', 'status'].map((f) => `contains(tolower(${f}),tolower(${lit}))`).join(' or ');

const and = (...filters: (string | null)[]) =>
  filters.filter((f): f is string => Boolean(f)).map((f) => `(${f})`).join(' and ') || null;

router.get(
  '/api/customer/fleets',
  ...requireCapability('device.read'),
  wrap(async (req, res) => {
    const scope = await scopeFor(req);
    const rows = await odataGet<Record<string, unknown>>(
      odataQuery('application', { $select: APPLICATION_SELECT, $filter: scopeFilter(scope, 'id'), $orderby: 'app_name asc' }),
    );
    const fleets = rows.filter((r) => inScope(scope, r.id as number));
    res.json({ data: fleets.map(toLookupApplication), total: fleets.length });
  }),
);

router.get(
  '/api/customer/devices',
  ...requireCapability('device.read'),
  wrap(async (req, res) => {
    let ids: number[] | null = null;
    if (req.query.ids !== undefined) ids = parseIds(req.query.ids);
    const scope = await scopeFor(req);
    let fleetFilter: string | null = null;
    if (req.query.fleetId !== undefined && req.query.fleetId !== '') {
      const fleetId = Number(req.query.fleetId);
      if (!Number.isInteger(fleetId) || !inScope(scope, fleetId)) throw new HttpError(403, 'Fleet not accessible');
      fleetFilter = `belongs_to__application eq ${fleetId}`;
    }
    const idsFilter = ids ? ids.map((id) => `id eq ${id}`).join(' or ') : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const filter = and(
      scopeFilter(scope, 'belongs_to__application'),
      fleetFilter,
      idsFilter,
      req.query.online === '1' ? `api_heartbeat_state eq 'online'` : null,
      q ? searchFilter(odataString(q)) : null,
    );
    const page = intParam(req.query.page, 1, 1, 10_000);
    const perPage = intParam(req.query.perPage, 25, 1, 200);
    const sortKey = String(req.query.sort);
    const sort = Object.prototype.hasOwnProperty.call(DEVICE_SORTS, sortKey) ? DEVICE_SORTS[sortKey] : 'device_name';
    const order = req.query.order === 'DESC' ? 'desc' : 'asc';
    const [devices, total] = await Promise.all([
      odataGet<RawDevice>(
        odataQuery('device', {
          $select: DEVICE_SELECT,
          $filter: filter,
          $orderby: `${sort} ${order}`,
          $top: perPage,
          $skip: (page - 1) * perPage,
        }),
      ),
      odataCount('device', filter),
    ]);
    const visible = devices.filter((d) => inScope(scope, refId(d.belongs_to__application)));
    res.json({ data: visible.map(toCustomerDevice), total });
  }),
);

router.get(
  '/api/customer/devices/:id',
  ...requireCapability('device.read'),
  wrap(async (req, res) => {
    res.json(toCustomerDevice(await loadDeviceByIdInScope(req)));
  }),
);

type Rec = Record<string, unknown>;

// Fleets and releases are limited to in-scope fleets; device types are public catalogue data.
const LOOKUPS: Record<
  string,
  { resource: string; select: string; map: (r: Rec) => Rec; fleetField: string | null }
> = {
  application: { resource: 'application', select: APPLICATION_SELECT, map: toLookupApplication, fleetField: 'id' },
  release: { resource: 'release', select: RELEASE_FULL_SELECT, map: toLookupRelease, fleetField: 'belongs_to__application' },
  'device type': { resource: 'device_type', select: DEVICE_TYPE_SELECT, map: toLookupDeviceType, fleetField: null },
};

const MAX_LOOKUP_IDS = 100;

function parseIds(v: unknown): number[] {
  if (typeof v !== 'string' || !v) throw new HttpError(400, 'ids is required');
  const parts = v.split(',');
  if (!parts.every((p) => POSITIVE_INT_RE.test(p))) throw new HttpError(400, 'ids must be positive integers');
  const ids = [...new Set(parts.map(Number))];
  if (ids.length > MAX_LOOKUP_IDS) throw new HttpError(400, `At most ${MAX_LOOKUP_IDS} ids`);
  return ids;
}

router.get(
  '/api/customer/lookup/:resource',
  ...requireCapability('device.read'),
  wrap(async (req, res) => {
    const name = String(req.params.resource);
    if (!Object.prototype.hasOwnProperty.call(LOOKUPS, name)) throw new HttpError(404, 'Unknown resource');
    const lookup = LOOKUPS[name];
    const ids = parseIds(req.query.ids);
    const scope = await scopeFor(req);
    const rows = await odataGet<Rec>(
      odataQuery(lookup.resource, {
        $select: lookup.select,
        $filter: and(ids.map((id) => `id eq ${id}`).join(' or '), lookup.fleetField && scopeFilter(scope, lookup.fleetField)),
      }),
    );
    const visible = lookup.fleetField
      ? rows.filter((r) => inScope(scope, refId(r[lookup.fleetField === 'id' ? 'id' : lookup.fleetField!])))
      : rows;
    res.json({ data: visible.filter((r) => ids.includes(r.id as number)).map(lookup.map) });
  }),
);

type RawInstall = {
  status: string;
  is_provided_by__release?: unknown;
  installs__image: { id: number; is_a_build_of__service?: { id: number; service_name: string }[] }[];
};

export async function deviceServices(deviceId: number, runningOnly = false) {
  const installs = await odataGet<RawInstall>(
    odataQuery('image_install', {
      $select: 'id,status,installs__image,is_provided_by__release',
      $filter: runningOnly ? `device eq ${deviceId} and status eq 'Running'` : `device eq ${deviceId}`,
      $expand: 'installs__image($select=id;$expand=is_a_build_of__service($select=id,service_name))',
    }),
  );
  return installs
    .map((i) => {
      const image = i.installs__image?.[0];
      const service = image?.is_a_build_of__service?.[0];
      return image && service?.service_name
        ? {
            imageId: image.id,
            serviceId: service.id,
            serviceName: service.service_name,
            releaseId: refId(i.is_provided_by__release),
            status: i.status,
          }
        : null;
    })
    .filter((s): s is CustomerService => s !== null);
}

router.get(
  '/api/customer/devices/:uuid/services',
  ...requireCapability('device.read'),
  wrap(async (req, res) => {
    const device = await loadDeviceInScope(req);
    res.json(await deviceServices(device.id));
  }),
);

router.post(
  '/api/customer/devices/:uuid/reboot',
  ...dosProtect,
  ...requireCapability('device.actions'),
  audited('device.reboot'),
  wrap(async (req, res) => {
    const device = await loadDeviceInScope(req);
    await apiPost('/supervisor/v1/reboot', { uuid: device.uuid });
    res.json({ success: true });
  }),
);

const SERVICE_COMMANDS = new Set(['start', 'stop', 'restart']);

router.post(
  '/api/customer/devices/:uuid/services/:imageId/:command',
  ...dosProtect,
  ...requireCapability('device.actions'),
  audited('service.command'),
  wrap(async (req, res) => {
    const command = String(req.params.command);
    const imageId = Number(req.params.imageId);
    if (!SERVICE_COMMANDS.has(command)) throw new HttpError(400, 'Unknown command');
    if (!Number.isInteger(imageId) || imageId <= 0) throw new HttpError(400, 'Invalid image id');
    const device = await loadDeviceInScope(req);
    req.auditDetails = { command, imageId };
    const fleetId = refId(device.belongs_to__application);
    await apiPost(`/supervisor/v2/applications/${fleetId}/${command}-service`, { uuid: device.uuid, data: { imageId } });
    res.json({ success: true });
  }),
);

router.get(
  '/api/customer/devices/:uuid/logs',
  ...requireCapability('device.logs'),
  wrap(async (req, res) => {
    const device = await loadDeviceInScope(req);
    const logs = await apiGetJson<Record<string, unknown>[]>(`/device/v2/${device.uuid}/logs`);
    res.json(logs.map(toCustomerLog));
  }),
);

const tagText = (v: unknown, field: string, max: number, allowEmpty: boolean) => {
  if (typeof v !== 'string' || v.length > max || (!allowEmpty && !v.trim())) {
    throw new HttpError(400, `${field} must be ${allowEmpty ? '' : 'a non-empty '}string up to ${max} characters`);
  }
  return v;
};

async function loadTag(deviceId: number, tagIdParam: unknown) {
  const tagId = Number(tagIdParam);
  if (!Number.isInteger(tagId) || tagId <= 0) throw new HttpError(404, 'Tag not found');
  const [tag] = await odataGet<{ id: number; tag_key: string }>(
    odataQuery('device_tag', { $select: 'id,tag_key', $filter: `device eq ${deviceId} and id eq ${tagId}` }),
  );
  if (!tag) throw new HttpError(404, 'Tag not found');
  return { id: tagId, key: tag.tag_key };
}

router.get(
  '/api/customer/devices/:uuid/tags',
  ...requireCapability('device.read'),
  wrap(async (req, res) => {
    const device = await loadDeviceInScope(req);
    const tags = await odataGet<{ id: number; tag_key: string; value: string }>(
      odataQuery('device_tag', { $select: 'id,tag_key,value', $filter: `device eq ${device.id}`, $orderby: 'tag_key asc' }),
    );
    res.json(tags.map((t) => ({ id: t.id, key: t.tag_key, value: t.value })));
  }),
);

router.post(
  '/api/customer/devices/:uuid/tags',
  ...dosProtect,
  ...requireCapability('device.tags.write'),
  audited('tag.create'),
  wrap(async (req, res) => {
    const key = tagText(req.body?.key, 'key', 100, false);
    const value = tagText(req.body?.value, 'value', 1000, true);
    const device = await loadDeviceInScope(req);
    req.auditDetails = { key };
    await odataPost('device_tag', { device: device.id, tag_key: key, value });
    res.json({ success: true });
  }),
);

router.patch(
  '/api/customer/devices/:uuid/tags/:tagId',
  ...dosProtect,
  ...requireCapability('device.tags.write'),
  audited('tag.update'),
  wrap(async (req, res) => {
    const value = tagText(req.body?.value, 'value', 1000, true);
    const device = await loadDeviceInScope(req);
    const tag = await loadTag(device.id, req.params.tagId);
    req.auditDetails = { key: tag.key };
    await odataPatch(`device_tag(${tag.id})`, { value });
    res.json({ success: true });
  }),
);

router.delete(
  '/api/customer/devices/:uuid/tags/:tagId',
  ...dosProtect,
  ...requireCapability('device.tags.delete'),
  audited('tag.delete'),
  wrap(async (req, res) => {
    const device = await loadDeviceInScope(req);
    const tag = await loadTag(device.id, req.params.tagId);
    req.auditDetails = { key: tag.key };
    await odataDelete(`device_tag(${tag.id})`);
    res.json({ success: true });
  }),
);

router.get(
  '/api/customer/devices/:uuid/releases',
  ...requireCapability('device.release.pin'),
  wrap(async (req, res) => {
    const device = await loadDeviceInScope(req);
    const releases = await odataGet<Parameters<typeof toCustomerRelease>[0]>(
      odataQuery('release', {
        $select: RELEASE_SELECT,
        $filter: `belongs_to__application eq ${refId(device.belongs_to__application)} and status eq 'success'`,
        $orderby: 'created_at desc',
        $top: 100,
      }),
    );
    res.json(releases.map(toCustomerRelease));
  }),
);

router.patch(
  '/api/customer/devices/:uuid/pinned-release',
  ...dosProtect,
  ...requireCapability('device.release.pin'),
  audited('release.pin'),
  wrap(async (req, res) => {
    const releaseId = req.body?.releaseId;
    if (releaseId !== null && (typeof releaseId !== 'number' || !Number.isInteger(releaseId) || releaseId <= 0)) {
      throw new HttpError(400, 'releaseId must be a release id or null');
    }
    const device = await loadDeviceInScope(req);
    req.auditDetails = releaseId === null ? { unpinned: true } : { releaseId };
    if (releaseId !== null) {
      const [release] = await odataGet<{ id: number; raw_version?: string }>(
        odataQuery('release', {
          $select: 'id,raw_version',
          $filter: `id eq ${releaseId} and belongs_to__application eq ${refId(device.belongs_to__application)} and status eq 'success'`,
        }),
      );
      if (!release) throw new HttpError(403, 'Release does not belong to the device fleet');
      req.auditDetails = { releaseId, version: release.raw_version ?? null };
    }
    await odataPatch(`device(${device.id})`, { [PINNED_RELEASE_FIELD]: releaseId });
    res.json({ success: true });
  }),
);

const SSH_KEY_RE = /^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+( [\x20-\x7e]*)?$/;

router.get(
  '/api/customer/devices/:uuid/connect',
  ...requireCapability('device.terminal'),
  wrap(async (req, res) => {
    const device = await loadDeviceInScope(req);
    const [[user], services] = await Promise.all([
      odataGet<{ username: string }>(odataQuery(`user(${req.user!.id})`, { $select: 'username' })),
      deviceServices(device.id, true),
    ]);
    res.json({
      uuid: device.uuid,
      username: user?.username ?? '',
      containers: [...new Set(services.map((s) => s.serviceName))],
    });
  }),
);

// Public keys can't be edited through the API, so the old one is replaced. The target device must be in scope.
router.post(
  '/api/customer/ssh-key',
  ...dosProtect,
  ...requireCapability('device.terminal'),
  audited('terminal.open'),
  wrap(async (req, res) => {
    const publicKey = req.body?.publicKey;
    if (typeof publicKey !== 'string' || publicKey.length > 4096 || !SSH_KEY_RE.test(publicKey)) {
      throw new HttpError(400, 'Invalid SSH public key');
    }
    const deviceUuid = req.body?.deviceUuid;
    if (!isDeviceUuid(deviceUuid)) throw new HttpError(400, 'deviceUuid required');
    await loadDeviceInScope(req, deviceUuid);
    await replaceRemoteKey(req.headers.authorization!, req.user!.id, publicKey);
    res.json({ success: true });
  }),
);

export default router;
