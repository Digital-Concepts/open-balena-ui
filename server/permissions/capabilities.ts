import { HttpError } from '../lib/httpError';

export const CAPABILITIES = [
  'admin',
  'device.read',
  'device.logs',
  'device.actions',
  'device.terminal',
  'device.tags.write',
  'device.tags.delete',
  'device.release.pin',
  'device.ssh',
  'device.loglevel',
  'device.files',
  'device.logs.download',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CUSTOMER_STANDARD: Capability[] = [
  'device.read',
  'device.logs',
  'device.actions',
  'device.terminal',
  'device.tags.write',
  'device.release.pin',
];

const known = new Set<string>(CAPABILITIES);

// Validates a capability list; admin swallows everything else, every customer flag implies device.read.
export function normalizeCapabilities(input: unknown): Capability[] {
  if (!Array.isArray(input) || input.some((c) => typeof c !== 'string')) {
    throw new HttpError(400, 'capabilities must be an array of strings');
  }
  const unknown = input.filter((c) => !known.has(c));
  if (unknown.length) throw new HttpError(400, `Unknown capabilities: ${unknown.join(', ')}`);
  if (input.length === 0) throw new HttpError(400, 'At least one capability is required');
  if (input.includes('admin')) return ['admin'];
  const set = new Set<Capability>(input as Capability[]);
  set.add('device.read');
  return CAPABILITIES.filter((c) => set.has(c));
}

export function hasCapability(caps: readonly Capability[], cap: Capability): boolean {
  return caps.includes('admin') || caps.includes(cap);
}
