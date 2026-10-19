export const ODATA_VERSION = process.env.OPEN_BALENA_ODATA_VERSION || 'v7';
export const PINNED_RELEASE_FIELD = process.env.OPEN_BALENA_PIN_FIELD || 'is_pinned_on__release';
export const RELEASE_SELECT = 'id,commit,raw_version,status,created_at,belongs_to__application';
export const DEVICE_SELECT = [
  'id',
  'uuid',
  'device_name',
  'belongs_to__application',
  'is_of__device_type',
  'api_heartbeat_state',
  'is_online',
  'is_connected_to_vpn',
  'last_vpn_event',
  'last_connectivity_event',
  'ip_address',
  'mac_address',
  'note',
  'status',
  'os_version',
  'os_variant',
  'supervisor_version',
  'is_running__release',
  PINNED_RELEASE_FIELD,
  'cpu_usage',
  'cpu_temp',
  'memory_usage',
  'memory_total',
  'storage_usage',
  'storage_total',
  'created_at',
].join(',');
export const APPLICATION_SELECT = 'id,app_name,slug,organization,should_be_running__release,should_track_latest_release';
export const RELEASE_FULL_SELECT =
  'id,commit,semver_major,semver_minor,semver_patch,semver_prerelease,semver_build,revision,raw_version,status,created_at,is_final,belongs_to__application';
export const DEVICE_TYPE_SELECT = 'id,slug,name';
