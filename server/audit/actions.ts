export const AUDIT_ACTIONS = [
  'device.reboot',
  'service.command',
  'tag.create',
  'tag.update',
  'tag.delete',
  'release.pin',
  'terminal.open',
  'ssh.set',
  'loglevel.set',
  'files.upload',
  'files.download',
  'logs.download',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
