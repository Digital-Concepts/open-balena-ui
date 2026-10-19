// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { parseUploads, shortName } from '../deviceJob';

function run(err: unknown) {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  parseUploads(((_req: any, _res: any, cb: any) => cb(err)) as any)({} as any, res, next);
  return { res, next };
}

describe('parseUploads', () => {
  it('passes through without an error', () => {
    const { res, next } = run(undefined);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('maps an oversized file to 413', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, next } = run({ code: 'LIMIT_FILE_SIZE' });
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ error: 'File too large' });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['LIMIT_FILE_COUNT', 'LIMIT_PART_COUNT', 'LIMIT_FIELD_COUNT', 'LIMIT_UNEXPECTED_FILE', undefined])(
    'maps %s to 400',
    (code) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { res } = run({ code });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid upload' });
    },
  );
});

describe('shortName', () => {
  it.each([
    ['gw-123', undefined, 'gw'],
    ['a b-1', undefined, 'a_b'],
    ['-x', 'abcdef0123456789', 'abcdef01'],
    ['', 'abcdef0123456789', 'abcdef01'],
    [undefined, 'abcdef0123456789', 'abcdef01'],
  ])('%j -> %j', (name, uuid, expected) => {
    expect(shortName(name, uuid)).toBe(expected);
  });
});
