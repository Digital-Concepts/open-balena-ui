export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'device.reboot': 'Reboot device',
  'service.command': 'Service command',
  'tag.create': 'Create tag',
  'tag.update': 'Update tag',
  'tag.delete': 'Delete tag',
  'release.pin': 'Pin release',
  'terminal.open': 'Open terminal',
  'ssh.set': 'Set SSH access',
  'loglevel.set': 'Set log level',
  'files.upload': 'Upload file',
  'files.download': 'Download file',
  'logs.download': 'Download logs',
};

export const auditActionLabel = (action: string): string => AUDIT_ACTION_LABELS[action] ?? action;
