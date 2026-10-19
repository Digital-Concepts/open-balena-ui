export const CAPABILITY_CHOICES = [
  { id: 'admin', name: 'Admin — full access (overrides everything)' },
  { id: 'device.read', name: 'View own fleets and devices' },
  { id: 'device.logs', name: 'Device logs' },
  { id: 'device.actions', name: 'Reboot, start/stop/restart services' },
  { id: 'device.terminal', name: 'Terminal (SSH)' },
  { id: 'device.tags.write', name: 'Create and edit device tags' },
  { id: 'device.tags.delete', name: 'Delete device tags' },
  { id: 'device.ssh', name: 'Gateway SSH on/off' },
  { id: 'device.loglevel', name: 'Change log level' },
  { id: 'device.files', name: 'Upload / download files (/opt/spaceport)' },
  { id: 'device.logs.download', name: 'Download log archive' },
  { id: 'device.release.pin', name: 'Pin a release of the device fleet' },
];
