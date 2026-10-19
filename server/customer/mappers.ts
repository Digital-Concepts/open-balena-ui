import { PINNED_RELEASE_FIELD } from '../lib/balenaFields';
import { refId } from '../lib/balenaApi';
import type { RawDevice } from './scope';

type Rec = Record<string, unknown>;

export type CustomerFleet = { id: number; name: string };
export type CustomerService = { imageId: number; serviceId: number; serviceName: string; releaseId: number | null; status: string };
export type CustomerTag = { id: number; key: string; value: string };
export type CustomerRelease = { id: number; label: string; commit: string; status: string; createdAt: string };
export type CustomerLog = { message: string; timestamp: number; serviceId: number | null; isStderr: boolean; isSystem: boolean };

type RawRelease = { id: number; commit: string; raw_version?: string | null };

// Records use the admin (PostgREST) field names so the admin components render them unchanged.
export function toCustomerDevice(d: RawDevice): Rec {
  const pinned = refId(d[PINNED_RELEASE_FIELD]);
  return {
    id: d.id,
    uuid: d.uuid,
    'device name': d.device_name,
    'belongs to-application': refId(d.belongs_to__application),
    'is of-device type': refId(d.is_of__device_type),
    'api heartbeat state': d.api_heartbeat_state,
    'is online': d.is_online,
    'is connected to vpn': d.is_connected_to_vpn,
    'last vpn event': d.last_vpn_event,
    'last connectivity event': d.last_connectivity_event,
    'ip address': d.ip_address,
    'mac address': d.mac_address,
    note: d.note,
    status: d.status,
    'os version': d.os_version,
    'os variant': d.os_variant,
    'supervisor version': d.supervisor_version,
    'is running-release': refId(d.is_running__release),
    'should be running-release': pinned,
    'is pinned on-release': pinned,
    'cpu usage': d.cpu_usage,
    'cpu temp': d.cpu_temp,
    'memory usage': d.memory_usage,
    'memory total': d.memory_total,
    'storage usage': d.storage_usage,
    'storage total': d.storage_total,
    'created at': d.created_at,
  };
}

export function toLookupApplication(a: Rec): Rec {
  return {
    id: a.id,
    'app name': a.app_name,
    slug: a.slug,
    organization: refId(a.organization),
    'should be running-release': refId(a.should_be_running__release),
    'should track latest release': a.should_track_latest_release,
  };
}

export function toLookupRelease(r: Rec): Rec {
  return {
    id: r.id,
    commit: r.commit,
    'semver major': r.semver_major,
    'semver minor': r.semver_minor,
    'semver patch': r.semver_patch,
    'semver prerelease': r.semver_prerelease,
    'semver build': r.semver_build,
    'semver revision': r.revision,
    'raw version': r.raw_version,
    status: r.status,
    'created at': r.created_at,
    'is final': r.is_final,
    'belongs to-application': refId(r.belongs_to__application),
  };
}

export function toLookupDeviceType(t: Rec): Rec {
  return { id: t.id, slug: t.slug, name: t.name };
}

export function toCustomerRelease(r: RawRelease & { status: string; created_at: string }): CustomerRelease {
  return { id: r.id, label: r.raw_version || r.commit.slice(0, 7), commit: r.commit, status: r.status, createdAt: r.created_at };
}

export function toCustomerLog(l: Record<string, unknown>): CustomerLog {
  return {
    message: String(l.message ?? ''),
    timestamp: Number(l.timestamp ?? 0),
    serviceId: typeof l.serviceId === 'number' ? l.serviceId : null,
    isStderr: Boolean(l.isStderr),
    isSystem: Boolean(l.isSystem),
  };
}
